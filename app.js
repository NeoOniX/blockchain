// ----------------- IMPORTS -----------------
import { contractABI, contractAddress } from "./abi.js";

// ----------------- UI HELPERS -----------------
window.UIHelpers = {
  alert: function (type, msg) {
    const wrap = document.getElementById("alerts");
    const div = document.createElement("div");
    div.className = "alert alert-" + type;
    div.innerText = msg;
    wrap.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  },

  setStatusBadge: function (isOpen) {
    const el = document.getElementById("status");
    el.classList.remove("status-open", "status-closed", "status-pending");
    if (isOpen === true) {
      el.classList.add("status-open");
      el.textContent = "Ouvert";
    } else if (isOpen === false) {
      el.classList.add("status-closed");
      el.textContent = "Fermé";
    } else {
      el.classList.add("status-pending");
      el.textContent = "Indéterminé";
    }
  },

  renderResultsBars: function (names, votes, options = {}) {
    const isOpen = !!options.isOpen;
    const toNum = (x) => (typeof x === "bigint" ? Number(x) : Number(x));

    // Associe nom et votes, tri décroissant
    let combined = names
      .map((n, i) => ({
        name: n,
        votes: toNum(votes[i]),
      }))
      .sort((a, b) => b.votes - a.votes);

    const total = combined.reduce((sum, c) => sum + c.votes, 0) || 1;

    const root = document.getElementById("resultsVisual");
    root.innerHTML = "";

    let winnerIdxs = [];
    if (!isOpen) {
      const maxVotes = Math.max(...combined.map((c) => c.votes));
      winnerIdxs = combined
        .map((c, i) => (c.votes === maxVotes ? i : -1))
        .filter((i) => i !== -1);
    }

    combined.forEach((c, i) => {
      const pc = Math.round((c.votes * 100) / total);
      const isWinner = !isOpen && winnerIdxs.includes(i);
      const crown = isWinner
        ? `<span class="crown" title="Gagnant">👑</span>`
        : "";

      const line = document.createElement("div");
      line.className = "result-line";
      line.innerHTML = `
        <div class="result-name">
          <span>${c.name} ${crown}</span>
          <span>${c.votes} vote(s)</span>
        </div>
        <div class="progress">
          <div class="progress-bar${
            isWinner ? " bg-success" : ""
          }" style="width:${pc}%"></div>
        </div>
      `;
      root.appendChild(line);
    });
  },
};

// ----------------- VARIABLES GLOBALES -----------------
let provider,
  signer,
  contract,
  currentAccount = null;

// ----------------- HELPERS -----------------
function toNum(x) {
  if (typeof x === "bigint") return Number(x);
  if (x && typeof x.toNumber === "function") return x.toNumber();
  return Number(x);
}

function el(id) {
  return document.getElementById(id);
}

function safeText(id, text) {
  const n = el(id);
  if (n) n.textContent = text;
}

function getErrorMessage(e) {
  return (
    e?.data?.data?.reason ||
    e?.error?.message ||
    e?.reason ||
    e?.message ||
    "Erreur inconnue"
  );
}

// ----------------- CONNEXION -----------------
el("connectButton").addEventListener("click", async () => {
  try {
    if (!window.ethereum) {
      alert("Installe MetaMask !");
      return;
    }

    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();

    contract = new ethers.Contract(contractAddress, contractABI, signer);

    safeText("contrat", contractAddress);

    currentAccount = await signer.getAddress();

    safeText("account", currentAccount);
    if (el("walletInfo")) el("walletInfo").style.display = "block";
    if (el("disconnectButton"))
      el("disconnectButton").style.display = "inline-block";
    if (el("connectButton")) el("connectButton").style.display = "none";

    await refreshUI();

    // Listeners
    window.ethereum.on("accountsChanged", async (accounts) => {
      if (!accounts.length) {
        disconnect();
      } else {
        currentAccount = accounts[0];
        signer = provider.getSigner();
        safeText("account", currentAccount);
        await refreshUI();
      }
    });

    window.ethereum.on("chainChanged", () => location.reload());
  } catch (error) {
    console.error("Erreur de connexion MetaMask :", error);
    window.UIHelpers?.alert?.(
      "danger",
      "Impossible de se connecter à MetaMask. Vérifie que l'extension est active."
    );
  }
});

// ----------------- DÉCONNEXION -----------------
el("disconnectButton").addEventListener("click", () => disconnect());

function disconnect() {
  provider = null;
  signer = null;
  contract = null;
  currentAccount = null;
  if (el("walletInfo")) el("walletInfo").style.display = "none";
  safeText("account", "");
  safeText("status", "Indéterminé");
  ["candidatesList", "resultsVisual", "resultsMessage"].forEach((id) => {
    const n = el(id);
    if (n) n.innerHTML = "";
  });
  if (el("disconnectButton")) el("disconnectButton").style.display = "none";
  if (el("connectButton")) el("connectButton").style.display = "inline-block";
  window.UIHelpers?.alert?.("info", "Déconnecté de MetaMask.");
}

// ----------------- SWITCH ACCOUNT -----------------
const switchBtn = el("switchAccountButton");
if (switchBtn) {
  switchBtn.addEventListener("click", async () => {
    try {
      if (!window.ethereum) {
        alert("Installe MetaMask !");
        return;
      }
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (accounts?.length) {
        currentAccount = accounts[0];
        signer = provider.getSigner();
        safeText("account", currentAccount);
        await refreshUI();
        window.UIHelpers?.alert?.("success", "Compte changé.");
      }
    } catch (e) {
      console.error(e);
      window.UIHelpers?.alert?.("warning", getErrorMessage(e));
    }
  });
}

// ----------------- RAFRAÎCHIR L'UI -----------------
async function refreshUI() {
  if (!contract) return;
  try {
    const statusRaw = await contract.status();
    const isOpen = toNum(statusRaw) === 0;
    safeText("status", isOpen ? "OUVERT" : "FERMÉ");
    window.UIHelpers?.setStatusBadge?.(isOpen);

    const candidates = await contract.getCandidates();
    const resultsRaw = await contract.getResults();
    const names = candidates.map((c) => c?.name ?? c?.[0] ?? String(c));
    const votes = resultsRaw.map((v) => toNum(v));

    let alreadyVoted = false;
    if (currentAccount && contract.hasVoted) {
      try {
        alreadyVoted = await contract.hasVoted(currentAccount);
      } catch {}
    }

    // Trier par ordre décroissant
    const combined = names
      .map((name, i) => ({
        name,
        votes: votes[i] || 0,
        index: i,
      }))
      .sort((a, b) => b.votes - a.votes);

    // Affichage des candidats
    const list = el("candidatesList");
    if (list) {
      list.innerHTML = "";
      combined.forEach(({ name, votes, index }) => {
        const row = document.createElement("div");
        row.className =
          "list-group-item d-flex justify-content-between align-items-center";

        const nameEl = document.createElement("span");
        nameEl.className = "flex-fill";
        nameEl.textContent = name || `Candidat ${index + 1}`;
        row.appendChild(nameEl);

        const badge = document.createElement("span");
        badge.className = "badge badge-primary badge-pill";
        badge.textContent = String(votes);
        row.appendChild(badge);

        if (isOpen && !alreadyVoted) {
          const btn = document.createElement("button");
          btn.className = "btn btn-sm btn-success ml-3";
          btn.textContent = "Voter";
          btn.onclick = async () => {
            try {
              const tx = await contract.vote(index);
              await tx.wait();
              await refreshUI();
            } catch (e) {
              window.UIHelpers?.alert?.("danger", getErrorMessage(e));
              console.error("Vote error:", e);
            }
          };
          row.appendChild(btn);
        }

        list.appendChild(row);
      });
    }

    // Résultats (message + barres)
    const msg = el("resultsMessage");
    const total = votes.reduce((a, b) => a + b, 0);
    if (msg) msg.innerHTML = "";

    if (!isOpen && msg) {
      if (total > 0) {
        const maxVotes = Math.max(...votes);
        const winners = votes
          .map((v, i) => (v === maxVotes ? i : -1))
          .filter((i) => i !== -1);
        const pct = ((maxVotes / total) * 100).toFixed(2);

        if (winners.length === 1) {
          msg.innerHTML = `
            <div class="alert alert-info mb-3">
              <strong>${
                names[winners[0]]
              }</strong> remporte le vote avec <strong>${pct}%</strong> des voix (${maxVotes}/${total}).
            </div>`;
        } else {
          const tied = winners.map((i) => names[i]).join(", ");
          msg.innerHTML = `
            <div class="alert alert-info mb-3">
              Égalité : <strong>${tied}</strong> avec <strong>${pct}%</strong> des voix chacun (${maxVotes}/${total}).
            </div>`;
        }
      } else {
        msg.innerHTML = `<div class="alert alert-secondary mb-3">Aucun vote enregistré.</div>`;
      }
    }

    window.UIHelpers?.renderResultsBars?.(
      combined.map((c) => c.name),
      combined.map((c) => c.votes),
      { isOpen }
    );
  } catch (err) {
    console.error("refreshUI error:", err);
    window.UIHelpers?.alert?.("danger", "Impossible d’afficher les résultats.");
  }
}

// ----------------- BOUTONS ADMIN -----------------
el("openButton")?.addEventListener("click", async () => {
  if (!contract) return;
  try {
    const tx = await contract.open();
    await tx.wait();
    await refreshUI();
  } catch (e) {
    window.UIHelpers?.alert?.("danger", getErrorMessage(e));
    console.error("Open error:", e);
  }
});

el("closeButton")?.addEventListener("click", async () => {
  if (!contract) return;
  try {
    const tx = await contract.close();
    await tx.wait();
    await refreshUI();
  } catch (e) {
    window.UIHelpers?.alert?.("danger", getErrorMessage(e));
    console.error("Close error:", e);
  }
});
