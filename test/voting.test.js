const Vote = artifacts.require("Vote");

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const { expect } = chai;

contract("Vote", (accounts) => {
  const [owner, user1, user2] = accounts;
  const CANDS = ["Alice", "Bob", "Charlie"];
  let instance;

  beforeEach(async () => {
    instance = await Vote.new(CANDS, { from: owner });
  });

  it("init: owner défini, status OPEN, 3 candidats", async () => {
    expect(await instance.owner()).to.equal(owner);
    const status = await instance.status();
    expect(status.toNumber()).to.equal(0); // OPEN
    const count = await instance.candidatesCount();
    expect(count.toNumber()).to.equal(3);
  });

  it("vote unique par adresse et comptage OK", async () => {
    await instance.vote(1, { from: user1 }); // Bob
    const hasVoted = await instance.hasVoted(user1);
    expect(hasVoted).to.equal(true);

    await expect(instance.vote(2, { from: user1 })).to.be.rejected;

    await instance.vote(1, { from: user2 });
    const res = await instance.getResults();
    expect(res[0].toNumber()).to.equal(0); // Alice
    expect(res[1].toNumber()).to.equal(2); // Bob
    expect(res[2].toNumber()).to.equal(0); // Charlie
  });

  it("refuse index candidat invalide", async () => {
    await expect(instance.vote(99, { from: user1 })).to.be.rejected;
  });

  it("close() bloque le vote, puis open() le rouvre", async () => {
    await instance.close({ from: owner });
    const statusAfterClose = await instance.status();
    expect(statusAfterClose.toNumber()).to.equal(1); // CLOSED

    await expect(instance.vote(0, { from: user1 })).to.be.rejected;

    await instance.open({ from: owner });
    const statusAfterOpen = await instance.status();
    expect(statusAfterOpen.toNumber()).to.equal(0); // OPEN

    await instance.vote(0, { from: user1 });
    const res = await instance.getResults();
    expect(res[0].toNumber()).to.equal(1);
  });

  it("seul l'owner peut open/close", async () => {
    await expect(instance.close({ from: user1 })).to.be.rejected;
    await expect(instance.open({ from: user1 })).to.be.rejected;
  });
});
