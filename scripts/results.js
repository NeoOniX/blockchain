const hre = require("hardhat");

async function main() {
  const contractAddress = process.env.CONTRACT || "PASTE_CONTRACT_ADDRESS";
  const Vote = await hre.ethers.getContractFactory("Vote");
  const vote = Vote.attach(contractAddress);
  const [names, votes] = await vote.getResults();
  console.log("=== Résultats ===");
  names.forEach((n, i) => console.log(`${n}: ${votes[i].toString()} vote(s)`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
