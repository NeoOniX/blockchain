const Vote = artifacts.require("Vote");

module.exports = async function (deployer, _network, accounts) {
  const candidates = [
    "Théo",
    "Dylan",
    "Aurélien",
    "Aurian",
    "Mathias",
    "Gauthier",
    "Valentin",
  ];

  await deployer.deploy(Vote, candidates, { from: accounts[0] });
};
