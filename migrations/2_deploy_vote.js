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

  const startDelaySeconds = 120;
  const durationInSeconds = 120;

  await deployer.deploy(
    Vote,
    candidates,
    startDelaySeconds,
    durationInSeconds,
    {
      from: accounts[0],
    }
  );
};
