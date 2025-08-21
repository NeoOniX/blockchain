// app.js

let provider, signer, contract;
import { contractABI, contractAddress } from "./abi.js";

// Connexion MetaMask
document.getElementById("connectButton").addEventListener("click", async () => {
  if (!window.ethereum) {
    alert("Installe MetaMask !");
    return;
  }

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();

  contract = new ethers.Contract(contractAddress, contractABI, signer);

  const account = await signer.getAddress();
  document.getElementById("account").textContent = account;
  document.getElementById("walletInfo").style.display = "block";

  await refreshUI();
});

// Rafraîchir infos (statut + candidats + résultats)
async function refreshUI() {
  const status = await contract.status();
  document.getElementById("status").textContent =
    status === 0 ? "OUVERT" : "FERMÉ";

  const candidates = await contract.getCandidates();
  const results = await contract.getResults();

  const list = document.getElementById("candidatesList");
  list.innerHTML = "";

  candidates.forEach((cand, i) => {
    const li = document.createElement("li");
    li.className =
      "list-group-item d-flex justify-content-between align-items-center";

    li.textContent = cand.name;

    const badge = document.createElement("span");
    badge.className = "badge badge-primary badge-pill";
    badge.textContent = results[i].toString();

    li.appendChild(badge);

    // bouton voter si le vote est ouvert
    if (status === 0) {
      const btn = document.createElement("button");
      btn.className = "btn btn-sm btn-success ml-3";
      btn.textContent = "Voter";
      btn.onclick = async () => {
        try {
          const tx = await contract.vote(i);
          await tx.wait();
          await refreshUI();
        } catch (e) {
          alert("Erreur: " + e.message);
        }
      };
      li.appendChild(btn);
    }

    list.appendChild(li);
  });
}

// Boutons admin
document.getElementById("openButton").addEventListener("click", async () => {
  try {
    const tx = await contract.open();
    await tx.wait();
    await refreshUI();
  } catch (e) {
    alert("Erreur: " + e.message);
  }
});

document.getElementById("closeButton").addEventListener("click", async () => {
  try {
    const tx = await contract.close();
    await tx.wait();
    await refreshUI();
  } catch (e) {
    alert("Erreur: " + e.message);
  }
});
