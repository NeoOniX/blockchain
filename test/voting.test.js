/* eslint-disable no-undef */
const Vote = artifacts.require("Vote");

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const { expect } = chai;

// --- Helpers temps (remplacer tout ce bloc) ---
async function evmMine() {
  await new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() },
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
}

async function evmIncreaseTime(seconds) {
  if (seconds <= 0) return; // rien à faire
  await new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [seconds],
        id: Date.now(),
      },
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
  await evmMine();
}

async function latestTimestamp() {
  const block = await web3.eth.getBlock("latest");
  return Number(block.timestamp);
}

// Avance jusqu’à un timestamp cible en utilisant increaseTime (pas setNextBlockTimestamp)
async function fastForwardTo(targetTs) {
  const now = await latestTimestamp();
  const delta = targetTs - now;
  await evmIncreaseTime(delta);
}

// ---------- Helpers expectRevert ----------
async function expectRevert(promise, reasonContains) {
  try {
    await promise;
    expect.fail("Expected revert, but the call succeeded");
  } catch (err) {
    // Truffle/Ganache met souvent le message dans err.message
    if (reasonContains) {
      expect(String(err.message)).to.include(reasonContains);
    }
  }
}

async function expectRevertDeploy(deployFn, reasonContains) {
  try {
    await deployFn();
    expect.fail("Expected constructor revert, but deployment succeeded");
  } catch (err) {
    if (reasonContains) {
      expect(String(err.message)).to.include(reasonContains);
    }
  }
}

// ---------- Suite de tests ----------
contract("Vote (Truffle + chai-as-promised)", (accounts) => {
  const [owner, voter1, voter2, voter3, stranger] = accounts;
  const CANDS = ["Alice", "Bob", "Charlie"];
  const START_DELAY = 100; // secondes
  const DURATION = 1000; // secondes
  let vote;

  // déployé à chaque test pour isolement
  beforeEach(async () => {
    vote = await Vote.new(CANDS, START_DELAY, DURATION, { from: owner });
  });

  // -------- Constructor --------
  it("constructor: owner, startTime/endTime, candidats/ids", async () => {
    const ownerOnChain = await vote.owner();
    expect(ownerOnChain).to.equal(owner);

    const startTime = Number(await vote.startTime());
    const endTime = Number(await vote.endTime());
    const nowTs = await latestTimestamp();

    expect(startTime).to.be.greaterThanOrEqual(nowTs);
    expect(endTime).to.equal(startTime + DURATION);

    const count = Number(await vote.candidatesCount());
    expect(count).to.equal(3);

    const ids = (await vote.getCandidates()).map((n) => Number(n));
    expect(ids).to.deep.equal([0, 1, 2]);

    const isOpen = await vote.isOpen();
    expect(isOpen).to.equal(false);
  });

  it("constructor: revert si < 2 candidats", async () => {
    await expectRevertDeploy(
      () => Vote.new(["Unique"], 0, 100, { from: owner }),
      "At least 2 candidates required"
    );
  });

  it("constructor: revert si duration = 0", async () => {
    await expectRevertDeploy(
      () => Vote.new(["A", "B"], 0, 0, { from: owner }),
      "Duration must be greater than zero"
    );
  });

  // -------- Contrôle d'accès --------
  it("seul l'owner peut addVoter/removeVoter", async () => {
    await expectRevert(vote.addVoter(voter1, { from: stranger }), "Not owner");
    await expectRevert(
      vote.removeVoter(voter1, { from: stranger }),
      "Not owner"
    );
  });

  // -------- Whitelist (avant le début) --------
  it("addVoter avant start → whitelist et événement VoterAdded", async () => {
    const receipt = await vote.addVoter(voter1, { from: owner });
    const ev = receipt.logs.find((l) => l.event === "VoterAdded");
    expect(ev, "VoterAdded non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);

    const whitelisted = await vote.isWhitelisted(voter1);
    expect(whitelisted).to.equal(true);
  });

  it("removeVoter avant start → suppression et événement VoterRemoved", async () => {
    await vote.addVoter(voter1, { from: owner });
    const receipt = await vote.removeVoter(voter1, { from: owner });
    const ev = receipt.logs.find((l) => l.event === "VoterRemoved");
    expect(ev, "VoterRemoved non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);

    const whitelisted = await vote.isWhitelisted(voter1);
    expect(whitelisted).to.equal(false);
  });

  it("idempotence: addVoter deux fois reste whitelisté", async () => {
    await vote.addVoter(voter1, { from: owner });
    const r2 = await vote.addVoter(voter1, { from: owner });
    const ev2 = r2.logs.find((l) => l.event === "VoterAdded");
    expect(ev2, "VoterAdded non émis au 2e add").to.exist;
    expect(await vote.isWhitelisted(voter1)).to.equal(true);
  });

  it("idempotence: removeVoter deux fois reste non-whitelisté", async () => {
    const r1 = await vote.removeVoter(voter1, { from: owner });
    const ev1 = r1.logs.find((l) => l.event === "VoterRemoved");
    expect(ev1, "VoterRemoved non émis au 1er remove").to.exist;

    const r2 = await vote.removeVoter(voter1, { from: owner });
    const ev2 = r2.logs.find((l) => l.event === "VoterRemoved");
    expect(ev2, "VoterRemoved non émis au 2e remove").to.exist;

    expect(await vote.isWhitelisted(voter1)).to.equal(false);
  });

  // -------- Whitelist (après le début) --------
  it("addVoter après start → revert", async () => {
    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime); // on va au début
    await expectRevert(
      vote.addVoter(voter1, { from: owner }),
      "Voting already started"
    );
  });

  it("removeVoter après start → revert", async () => {
    await vote.addVoter(voter1, { from: owner }); // avant start
    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime); // au début
    await expectRevert(
      vote.removeVoter(voter1, { from: owner }),
      "Voting already started"
    );
  });

  // -------- Fenêtre temporelle / bornes --------
  it("avant start → vote interdit (revert)", async () => {
    await vote.addVoter(voter1, { from: owner });
    await expectRevert(
      vote.vote(0, { from: voter1 }),
      "Vote has not started yet"
    );
    expect(await vote.isOpen()).to.equal(false);
  });

  it("à startTime (inclus) → isOpen true et vote OK", async () => {
    await vote.addVoter(voter1, { from: owner });
    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime); // exactement startTime

    expect(await vote.isOpen()).to.equal(true);
    const receipt = await vote.vote(1, { from: voter1 }); // Bob
    const ev = receipt.logs.find((l) => l.event === "Voted");
    expect(ev, "Voted non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);
    expect(Number(ev.args.candidateId)).to.equal(1);
  });

  it("à endTime (exclu) → vote interdit, isOpen false", async () => {
    await vote.addVoter(voter1, { from: owner });
    const startTime = Number(await vote.startTime());
    const endTime = Number(await vote.endTime());

    await fastForwardTo(startTime + 1);
    await vote.vote(0, { from: voter1 });

    await fastForwardTo(endTime); // borne droite
    expect(await vote.isOpen()).to.equal(false);
    await expectRevert(vote.vote(1, { from: voter1 }), "Vote is closed");
  });

  // -------- Vote : chemins heureux & erreurs --------
  it("whitelisté: vote unique + événement + hasUserVoted", async () => {
    await vote.addVoter(voter1, { from: owner });
    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime + 1);

    const r = await vote.vote(2, { from: voter1 }); // Charlie
    const ev = r.logs.find((l) => l.event === "Voted");
    expect(ev, "Voted non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);
    expect(Number(ev.args.candidateId)).to.equal(2);

    const has = await vote.hasUserVoted(voter1);
    expect(has).to.equal(true);

    await expectRevert(
      vote.vote(1, { from: voter1 }),
      "You have already voted"
    );
  });

  it("non-whitelisté: interdit de voter", async () => {
    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime + 1);
    await expectRevert(
      vote.vote(0, { from: stranger }),
      "You are not authorized to vote"
    );
  });

  it("candidateId invalide → revert", async () => {
    await vote.addVoter(voter1, { from: owner });
    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime + 1);
    await expectRevert(vote.vote(99, { from: voter1 }), "Invalid candidate");
  });

  it("comptage OK (2 pour Alice, 1 pour Charlie)", async () => {
    await vote.addVoter(voter1, { from: owner });
    await vote.addVoter(voter2, { from: owner });
    await vote.addVoter(voter3, { from: owner });
    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime + 1);

    await vote.vote(0, { from: voter1 }); // Alice
    await vote.vote(2, { from: voter2 }); // Charlie
    await vote.vote(0, { from: voter3 }); // Alice

    const res = await vote.getResults();
    expect(Number(res[0])).to.equal(2);
    expect(Number(res[1])).to.equal(0);
    expect(Number(res[2])).to.equal(1);
  });

  it("après la fin: vote refusé même si whitelisted", async () => {
    await vote.addVoter(voter1, { from: owner });
    const endTime = Number(await vote.endTime());
    await fastForwardTo(endTime);
    await expectRevert(vote.vote(0, { from: voter1 }), "Vote is closed");
  });

  // -------- Vues / helpers --------
  it("isWhitelisted / hasUserVoted reflètent l'état", async () => {
    expect(await vote.isWhitelisted(voter1)).to.equal(false);
    expect(await vote.hasUserVoted(voter1)).to.equal(false);

    await vote.addVoter(voter1, { from: owner });
    expect(await vote.isWhitelisted(voter1)).to.equal(true);

    const startTime = Number(await vote.startTime());
    await fastForwardTo(startTime + 1);
    await vote.vote(1, { from: voter1 });

    expect(await vote.hasUserVoted(voter1)).to.equal(true);
  });

  it("getCandidates renvoie des IDs séquentiels, candidatesCount cohérent", async () => {
    const ids = (await vote.getCandidates()).map((n) => Number(n));
    expect(ids).to.deep.equal([0, 1, 2]);
    const count = Number(await vote.candidatesCount());
    expect(count).to.equal(3);
  });
});
