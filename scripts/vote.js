const hre = require("hardhat");

async function main() {
  const [deployer, voter1, voter2] = await hre.ethers.getSigners();
  const contractAddress = process.env.CONTRACT || "PASTE_CONTRACT_ADDRESS";
  const Vote = await hre.ethers.getContractFactory("Vote");
  const vote = Vote.attach(contractAddress);

  // voter1 vote pour le candidat 0
  await vote.connect(voter1).vote(0);
  console.log(`voter1 (${voter1.address}) a voté pour 0`);

  // voter2 vote pour le candidat 2
  await vote.connect(voter2).vote(2);
  console.log(`voter2 (${voter2.address}) a voté pour 2`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
