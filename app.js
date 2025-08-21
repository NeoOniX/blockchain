// ----------------- IMPORTS -----------------
import { contractABI, contractAddress } from "./abi.js";

// ----------------- UI HELPERS -----------------
window.UIHelpers = {
  alert(type, msg) {
    const wrap = document.getElementById("alerts");
    const div = document.createElement("div");
    div.className = "alert alert-" + type;
    div.innerText = msg;
    wrap.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  },

  // state: 'pre' | 'open' | 'closed'
  setStatusBadge(state) {
    const el = document.getElementById("status");
    el.classList.remove("status-open", "status-closed", "status-pre");
    if (state === "open") {
      el.classList.add("status-open");
      el.textContent = "Ouvert";
    } else if (state === "closed") {
      el.classList.add("status-closed");
      el.textContent = "Fermé";
    } else {
      el.classList.add("status-pending");
      el.textContent = "Pré-ouverture";
    }
  },

  /**
   * Barres de résultats triées par nombre de votes (desc.).
   * @param {string[]} names
   * @param {(number|bigint|string)[]} votes
   * @param {{isOpen?: boolean}} options
   */
  renderResultsBars(names, votes, options = {}) {
    const isOpen = !!options.isOpen;
    const toNum = (x) => (typeof x === "bigint" ? Number(x) : Number(x));

    let combined = names
      .map((n, i) => ({ name: n, votes: toNum(votes[i]) }))
      .sort((a, b) => b.votes - a.votes);

    const total = combined.reduce((s, c) => s + c.votes, 0) || 1;

    const root = document.getElementById("resultsVisual");
    root.innerHTML = "";

    let winnerIdxs = [];
    if (!isOpen && combined.length) {
      const maxVotes = Math.max(...combined.map((c) => c.votes));
      winnerIdxs = combined
        .map((c, i) => (c.votes === maxVotes ? i : -1))
        .filter((i) => i !== -1);
    }

    combined.forEach((c, i) => {
      const pc = Math.round((c.votes * 100) / total);
      const isWinner = !isOpen && winnerIdxs.includes(i);
      const crown = isWinner ? `<span class="crown">👑</span>` : "";

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
let countdownTimer = null;

// ⚠️ noms affichés pour chaque ID (même ordre qu’au déploiement)
const candidateNames = [
  "Théo",
  "Dylan",
  "Aurélien",
  "Aurian",
  "Mathias",
  "Gauthier",
  "Valentin",
];

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
function formatTs(tsSec) {
  const d = new Date(Number(tsSec) * 1000);
  return d.toLocaleString();
}
function secsToHMS(s) {
  s = Math.max(0, s | 0);
  const h = (s / 3600) | 0;
  const m = ((s % 3600) / 60) | 0;
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec
  ).padStart(2, "0")}`;
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

    el("walletInfo").style.display = "block";
    el("disconnectButton").style.display = "inline-block";
    el("connectButton").style.display = "none";

    await refreshUI();
    await startCountdown();

    window.ethereum.on("accountsChanged", async (accounts) => {
      if (!accounts.length) {
        disconnect();
      } else {
        currentAccount = accounts[0];
        signer = provider.getSigner();
        safeText("account", currentAccount);
        await refreshUI();
        await startCountdown();
      }
    });

    window.ethereum.on("chainChanged", () => location.reload());
  } catch (error) {
    console.error("Erreur de connexion MetaMask :", error);
    window.UIHelpers.alert("danger", "Impossible de se connecter à MetaMask.");
  }
});

// (optionnel) changer de compte via bouton si présent
el("switchAccountButton")?.addEventListener("click", async () => {
  try {
    if (!window.ethereum) return;
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
      await startCountdown();
      window.UIHelpers.alert("success", "Compte changé.");
    }
  } catch (e) {
    window.UIHelpers.alert("warning", getErrorMessage(e));
  }
});

// ----------------- DÉCONNEXION -----------------
el("disconnectButton").addEventListener("click", () => disconnect());

function disconnect() {
  provider = null;
  signer = null;
  contract = null;
  currentAccount = null;
  if (countdownTimer) clearInterval(countdownTimer);
  el("walletInfo").style.display = "none";
  safeText("account", "");
  safeText("status", "Indéterminé");
  [
    "candidatesList",
    "resultsVisual",
    "resultsMessage",
    "endTimeText",
    "countdown",
  ].forEach((id) => {
    const n = el(id);
    if (n) n.innerHTML = "";
  });
  document.querySelector(".admin-section")?.style &&
    (document.querySelector(".admin-section").style.display = "none");
  el("disconnectButton").style.display = "none";
  el("connectButton").style.display = "inline-block";
  window.UIHelpers.alert("info", "Déconnecté de MetaMask.");
}

// ----------------- COUNTDOWN (pré-ouverture puis fin) -----------------
async function startCountdown() {
  if (!contract || !provider) return;
  try {
    const [startBn, endBn, latestBlock] = await Promise.all([
      contract.startTime(),
      contract.endTime(),
      provider.getBlock("latest"),
    ]);
    const start = toNum(startBn),
      end = toNum(endBn);
    let chainNow = Number(latestBlock.timestamp);

    if (countdownTimer) clearInterval(countdownTimer);
    const dateEl = el("endTimeText");
    const cdownEl = el("countdown");

    const tickPre = () => {
      const remain = start - chainNow;
      dateEl && (dateEl.textContent = "Début prévu : " + formatTs(start));
      cdownEl &&
        (cdownEl.textContent =
          remain > 0 ? secsToHMS(remain) : "Vote en cours !");
      chainNow++;
      if (remain <= 0) {
        clearInterval(countdownTimer);
        refreshUI();
      }
    };

    const tickOpen = () => {
      const remain = end - chainNow;
      dateEl && (dateEl.textContent = "Fin prévue : " + formatTs(end));
      cdownEl &&
        (cdownEl.textContent =
          remain > 0 ? secsToHMS(remain) : "Vote terminé !");
      chainNow++;
      if (remain <= 0) {
        clearInterval(countdownTimer);
        refreshUI();
      }
    };

    if (chainNow < start) {
      tickPre();
      countdownTimer = setInterval(tickPre, 1000);
    } else if (chainNow < end) {
      tickOpen();
      countdownTimer = setInterval(tickOpen, 1000);
    } else {
      dateEl && (dateEl.textContent = "Fin du vote");
      cdownEl && (cdownEl.textContent = "--:--:--");
    }
  } catch (e) {
    safeText("endTimeText", "Horaires indisponibles");
    safeText("countdown", "--:--:--");
  }
}

// ----------------- RAFRAÎCHIR L'UI -----------------
async function refreshUI() {
  if (!contract) return;
  try {
    // temps on-chain
    const [startBn, endBn, latestBlock] = await Promise.all([
      contract.startTime(),
      contract.endTime(),
      provider.getBlock("latest"),
    ]);
    const start = toNum(startBn),
      end = toNum(endBn),
      now = Number(latestBlock.timestamp);

    // état tri-phase
    const state = now < start ? "pre" : now < end ? "open" : "closed";

    window.UIHelpers.setStatusBadge(state);
    safeText(
      "status",
      state === "open"
        ? "OUVERT"
        : state === "closed"
        ? "FERMÉ"
        : "PRÉ-OUVERTURE"
    );

    // owner → section admin visible + verrouillage après début
    let isOwner = false;
    try {
      const owner = await contract.owner();
      isOwner = owner?.toLowerCase?.() === currentAccount?.toLowerCase?.();
    } catch {}
    const adminSection = document.querySelector(".admin-section");
    if (adminSection) adminSection.style.display = isOwner ? "block" : "none";
    const lockWhitelist = state !== "pre";
    ["addVoterButton", "removeVoterButton", "voterAddress"].forEach((id) => {
      const n = el(id);
      if (n) n.disabled = !isOwner || lockWhitelist;
    });

    // données de vote
    const [ids, votesRaw] = await Promise.all([
      contract.getCandidates(),
      contract.getResults(),
    ]);
    const names = ids.map(
      (id) => candidateNames[toNum(id)] ?? `Candidat ${toNum(id)}`
    );
    const votes = votesRaw.map(toNum);

    // état du compte courant
    let whitelisted = false,
      alreadyVoted = false;
    if (currentAccount) {
      try {
        whitelisted = await contract.isWhitelisted(currentAccount);
      } catch {}
      try {
        alreadyVoted = await contract.hasUserVoted(currentAccount);
      } catch {}
    }

    // liste candidats
    const list = el("candidatesList");
    if (list) {
      list.innerHTML = "";
      ids.forEach((id, i) => {
        const row = document.createElement("div");
        row.className =
          "list-group-item d-flex justify-content-between align-items-center";

        const nameEl = document.createElement("span");
        nameEl.className = "flex-fill";
        nameEl.textContent = names[i];
        row.appendChild(nameEl);

        const badge = document.createElement("span");
        badge.className = "badge badge-primary badge-pill";
        badge.textContent = String(votes[i]);
        row.appendChild(badge);

        if (state === "open" && whitelisted && !alreadyVoted) {
          const btn = document.createElement("button");
          btn.className = "btn btn-sm btn-success ml-3";
          btn.textContent = "Voter";
          btn.onclick = async () => {
            try {
              const tx = await contract.vote(toNum(id));
              await tx.wait();
              await refreshUI();
            } catch (e) {
              window.UIHelpers.alert("danger", getErrorMessage(e));
            }
          };
          row.appendChild(btn);
        }

        list.appendChild(row);
      });
    }

    // message gagnant (quand fermé)
    const msg = el("resultsMessage");
    if (msg) {
      msg.innerHTML = "";
      if (state === "closed") {
        const total = votes.reduce((a, b) => a + b, 0);
        if (total > 0) {
          const maxVotes = Math.max(...votes);
          const winners = votes
            .map((v, i) => (v === maxVotes ? i : -1))
            .filter((i) => i !== -1);
          const pct = ((maxVotes / total) * 100).toFixed(2);
          if (winners.length === 1) {
            msg.innerHTML = `<div class="alert alert-info mb-3"><strong>${
              names[winners[0]]
            }</strong> remporte le vote avec <strong>${pct}%</strong> des voix (${maxVotes}/${total}).</div>`;
          } else {
            const tied = winners.map((i) => names[i]).join(", ");
            msg.innerHTML = `<div class="alert alert-info mb-3">Égalité : <strong>${tied}</strong> avec <strong>${pct}%</strong> des voix chacun (${maxVotes}/${total}).</div>`;
          }
        } else {
          msg.innerHTML = `<div class="alert alert-secondary mb-3">Aucun vote enregistré.</div>`;
        }
      }
    }

    // barres résultats
    window.UIHelpers.renderResultsBars(names, votes, {
      isOpen: state === "open",
    });
  } catch (err) {
    console.error("refreshUI error:", err);
    window.UIHelpers.alert("danger", "Impossible d’afficher les résultats.");
  }
}

// ----------------- ADMIN : AJOUT/RETRAIT VOTANT -----------------
el("addVoterButton")?.addEventListener("click", async () => {
  if (!contract || !currentAccount) return;
  const addr = el("voterAddress")?.value.trim();
  if (!addr) return window.UIHelpers.alert("warning", "Adresse invalide.");
  try {
    const tx = await contract.addVoter(addr);
    await tx.wait();
    window.UIHelpers.alert("success", "Votant ajouté.");
    el("voterAddress").value = "";
    await refreshUI();
  } catch (e) {
    window.UIHelpers.alert("danger", getErrorMessage(e));
  }
});

el("removeVoterButton")?.addEventListener("click", async () => {
  if (!contract || !currentAccount) return;
  const addr = el("voterAddress")?.value.trim();
  if (!addr) return window.UIHelpers.alert("warning", "Adresse invalide.");
  try {
    const tx = await contract.removeVoter(addr);
    await tx.wait();
    window.UIHelpers.alert("success", "Votant retiré.");
    el("voterAddress").value = "";
    await refreshUI();
  } catch (e) {
    window.UIHelpers.alert("danger", getErrorMessage(e));
  }
});
