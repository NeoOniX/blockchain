/* eslint-disable no-undef */
const Vote = artifacts.require("Vote");

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const { expect } = chai;

/* ---------------- Helpers temps (Ganache/Truffle) ---------------- */
async function evmMine() {
  await new Promise((resolve, reject) => {
    web3.currentProvider.send(
      { jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() },
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
}

async function evmIncreaseTime(seconds) {
  if (seconds <= 0) return;
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

// Avance par delta jusqu’à targetTs
async function fastForwardTo(targetTs) {
  const now = await latestTimestamp();
  const delta = targetTs - now;
  await evmIncreaseTime(delta);
}

// Arrive *juste avant* ts puis +1s pour passer exactement la borne
async function goToBoundaryAndTick(ts) {
  const now = await latestTimestamp();
  if (now >= ts) {
    await evmIncreaseTime(1);
    return;
  }
  await fastForwardTo(ts - 1);
  await evmIncreaseTime(1);
}

// Ouvre "sûrement" la fenêtre : va à ts, sinon +1s si besoin
async function ensureOpenAt(contractInstance, ts) {
  await fastForwardTo(ts);
  const open = await contractInstance.isOpen();
  if (!open) {
    await evmIncreaseTime(1);
  }
}

/* ---------------- Helpers expectRevert ---------------- */
async function expectRevert(promise, reasonContains) {
  try {
    await promise;
    expect.fail("Expected revert, but the call succeeded");
  } catch (err) {
    const msg = String(err.message || err);
    if (reasonContains) expect(msg).to.include(reasonContains);
  }
}

async function expectRevertDeploy(deployFn, reasonContains) {
  try {
    await deployFn();
    expect.fail("Expected constructor revert, but deployment succeeded");
  } catch (err) {
    const msg = String(err.message || err);
    if (reasonContains) expect(msg).to.include(reasonContains);
  }
}

/* ---------------- Suite principale ---------------- */
contract("Vote (Truffle + chai-as-promised)", (accounts) => {
  const [owner, voter1, voter2, voter3, stranger] = accounts;
  const CANDS = ["Alice", "Bob", "Charlie"];
  const START_DELAY = 100; // s (>= 60 pour tester le gel)
  const DURATION = 1000; // s
  let vote;

  beforeEach(async () => {
    vote = await Vote.new(CANDS, START_DELAY, DURATION, { from: owner });
  });

  /* -------- Constructor -------- */
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

  /* -------- Accès owner -------- */
  it("seul l'owner peut addVoter/removeVoter", async () => {
    await expectRevert(vote.addVoter(voter1, { from: stranger }), "Not owner");
    await expectRevert(
      vote.removeVoter(voter1, { from: stranger }),
      "Not owner"
    );
  });

  /* -------- Whitelist (avant le début, hors gel) -------- */
  it("addVoter avant start et hors gel → whitelist + événement VoterAdded", async () => {
    const receipt = await vote.addVoter(voter1, { from: owner });
    const ev = receipt.logs.find((l) => l.event === "VoterAdded");
    expect(ev, "VoterAdded non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);
    expect(await vote.isWhitelisted(voter1)).to.equal(true);
  });

  it("removeVoter avant start et hors gel → suppression + événement VoterRemoved", async () => {
    await vote.addVoter(voter1, { from: owner });
    const receipt = await vote.removeVoter(voter1, { from: owner });
    const ev = receipt.logs.find((l) => l.event === "VoterRemoved");
    expect(ev, "VoterRemoved non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);
    expect(await vote.isWhitelisted(voter1)).to.equal(false);
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

  /* -------- Fenêtre de gel whitelist (60s avant start) -------- */
  it("peut modifier la whitelist à startTime - (FREEZE + 10)s (encore permis)", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await fastForwardTo(startTime - (FREEZE + 10)); // marge 10s
    const r = await vote.addVoter(voter1, { from: owner });
    const ev = r.logs.find((l) => l.event === "VoterAdded");
    expect(ev).to.exist;
  });

  it("NE peut PAS modifier la whitelist à startTime - FREEZE (début du gel inclus)", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await goToBoundaryAndTick(startTime - FREEZE);
    await expectRevert(
      vote.addVoter(voter1, { from: owner }),
      "Whitelist changes locked"
    );
    await expectRevert(
      vote.removeVoter(voter1, { from: owner }),
      "Whitelist changes locked"
    );
  });

  it("NE peut PAS modifier la whitelist pendant le gel (ex: -5s)", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await fastForwardTo(startTime - Math.max(5, FREEZE - 5));
    await expectRevert(
      vote.addVoter(voter1, { from: owner }),
      "Whitelist changes locked"
    );
  });

  /* -------- Whitelist (après le début) -------- */
  it("addVoter après start → revert (Voting already started)", async () => {
    const startTime = Number(await vote.startTime());
    await goToBoundaryAndTick(startTime);
    await expectRevert(
      vote.addVoter(voter1, { from: owner }),
      "Voting already started"
    );
  });

  it("removeVoter après start → revert (Voting already started)", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await fastForwardTo(startTime - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });

    await goToBoundaryAndTick(startTime);
    await expectRevert(
      vote.removeVoter(voter1, { from: owner }),
      "Voting already started"
    );
  });

  /* -------- Fenêtre temporelle / bornes -------- */
  it("avant start → vote interdit (revert)", async () => {
    await vote.addVoter(voter1, { from: owner });
    await expectRevert(
      vote.vote(0, { from: voter1 }),
      "Vote has not started yet"
    );
    expect(await vote.isOpen()).to.equal(false);
  });

  it("à startTime (inclus) → isOpen true et vote OK", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await fastForwardTo(startTime - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });

    await goToBoundaryAndTick(startTime);
    expect(await vote.isOpen()).to.equal(true);
    const receipt = await vote.vote(1, { from: voter1 }); // Bob
    const ev = receipt.logs.find((l) => l.event === "Voted");
    expect(ev, "Voted non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);
    expect(Number(ev.args.candidateId)).to.equal(1);
  });

  it("à endTime (exclu) → vote interdit, isOpen false", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());
    const endTime = Number(await vote.endTime());

    await fastForwardTo(startTime - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });

    await goToBoundaryAndTick(startTime + 1);
    await vote.vote(0, { from: voter1 });

    await goToBoundaryAndTick(endTime);
    expect(await vote.isOpen()).to.equal(false);
    await expectRevert(vote.vote(1, { from: voter1 }), "Vote is closed");
  });

  /* -------- Vote : chemins heureux & erreurs -------- */
  it("whitelisté: vote unique + événement + hasUserVoted", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await fastForwardTo(startTime - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });

    await goToBoundaryAndTick(startTime + 1);
    const r = await vote.vote(2, { from: voter1 }); // Charlie
    const ev = r.logs.find((l) => l.event === "Voted");
    expect(ev, "Voted non émis").to.exist;
    expect(ev.args.voter).to.equal(voter1);
    expect(Number(ev.args.candidateId)).to.equal(2);

    expect(await vote.hasUserVoted(voter1)).to.equal(true);
    await expectRevert(
      vote.vote(1, { from: voter1 }),
      "You have already voted"
    );
  });

  it("non-whitelisté: interdit de voter", async () => {
    const startTime = Number(await vote.startTime());
    await goToBoundaryAndTick(startTime + 1);
    await expectRevert(
      vote.vote(0, { from: stranger }),
      "You are not authorized to vote"
    );
  });

  it("candidateId invalide → revert", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await fastForwardTo(startTime - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });

    await goToBoundaryAndTick(startTime + 1);
    await expectRevert(vote.vote(99, { from: voter1 }), "Invalid candidate");
  });

  it("comptage OK (2 pour Alice, 1 pour Charlie)", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    const SAFETY = 40;
    await fastForwardTo(startTime - (FREEZE + SAFETY));

    await vote.addVoter(voter1, { from: owner });
    await vote.addVoter(voter2, { from: owner });
    await vote.addVoter(voter3, { from: owner });

    await ensureOpenAt(vote, startTime + 1);

    await vote.vote(0, { from: voter1 }); // Alice
    await vote.vote(2, { from: voter2 }); // Charlie
    await vote.vote(0, { from: voter3 }); // Alice

    const res = await vote.getResults();
    expect(Number(res[0])).to.equal(2);
    expect(Number(res[1])).to.equal(0);
    expect(Number(res[2])).to.equal(1);
  });

  it("après la fin: vote refusé même si whitelisted", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());
    const endTime = Number(await vote.endTime());

    await fastForwardTo(startTime - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });

    await goToBoundaryAndTick(endTime);
    await expectRevert(vote.vote(0, { from: voter1 }), "Vote is closed");
  });

  /* -------- Vues / helpers -------- */
  it("isWhitelisted / hasUserVoted reflètent l'état", async () => {
    expect(await vote.isWhitelisted(voter1)).to.equal(false);
    expect(await vote.hasUserVoted(voter1)).to.equal(false);

    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const startTime = Number(await vote.startTime());

    await fastForwardTo(startTime - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });
    expect(await vote.isWhitelisted(voter1)).to.equal(true);

    await goToBoundaryAndTick(startTime + 1);
    await vote.vote(1, { from: voter1 });
    expect(await vote.hasUserVoted(voter1)).to.equal(true);
  });

  it("getCandidates IDs séquentiels, candidatesCount cohérent", async () => {
    const ids = (await vote.getCandidates()).map((n) => Number(n));
    expect(ids).to.deep.equal([0, 1, 2]);
    expect(Number(await vote.candidatesCount())).to.equal(3);
  });

  /* -------- durationSeconds (scénarios dédiés) -------- */
  it("duration longue : vote reste ouvert avant endTime", async () => {
    const LONG = 5000;
    const v = await Vote.new(CANDS, 90, LONG, { from: owner });

    const FREEZE = Number(await v.WHITELIST_FREEZE());
    const st = Number(await v.startTime());
    const en = Number(await v.endTime());

    await fastForwardTo(st - (FREEZE + 10)); // hors gel
    await v.addVoter(voter1, { from: owner });

    await goToBoundaryAndTick(st + 10);
    expect(await v.isOpen()).to.equal(true);
    await v.vote(0, { from: voter1 });

    const now = await latestTimestamp();
    expect(now).to.be.lessThan(en);
  });

  it("duration = startDelay : endTime = startTime + duration", async () => {
    const delay = 120;
    const duration = 120;
    const v = await Vote.new(CANDS, delay, duration, { from: owner });
    const st = Number(await v.startTime());
    const en = Number(await v.endTime());
    expect(en).to.equal(st + duration);
  });

  it("avant start (duration = 1) : fermé tant que < startTime", async () => {
    const v = await Vote.new(CANDS, 90, 1, { from: owner });
    const FREEZE = Number(await v.WHITELIST_FREEZE());
    const st = Number(await v.startTime());

    await fastForwardTo(st - (FREEZE + 10)); // hors gel
    await v.addVoter(voter1, { from: owner });

    const now = await latestTimestamp();
    expect(now).to.be.lessThan(st);
    expect(await v.isOpen()).to.equal(false);
    await expectRevert(v.vote(0, { from: voter1 }), "Vote has not started yet");
  });

  /* -------- Gel + workflow réaliste -------- */
  it("workflow gel: ajout tôt → gel → ouverture → vote", async () => {
    const FREEZE = Number(await vote.WHITELIST_FREEZE());
    const st = Number(await vote.startTime());

    await fastForwardTo(st - (FREEZE + 10));
    await vote.addVoter(voter1, { from: owner });

    await fastForwardTo(st - FREEZE);
    await expectRevert(
      vote.removeVoter(voter1, { from: owner }),
      "Whitelist changes locked"
    );

    await goToBoundaryAndTick(st);
    const rc = await vote.vote(0, { from: voter1 });
    const ev = rc.logs.find((l) => l.event === "Voted");
    expect(ev).to.exist;
    expect(Number(ev.args.candidateId)).to.equal(0);
  });
});
