// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Vote {
    struct Candidate {
        uint8 id;
        uint8 voteCount;
    }

    address public owner;
    uint256 public startTime;
    uint256 public endTime;
    mapping(address => bytes1) private hasVoted;
    mapping(address => bytes1) private whitelist;
    Candidate[] public candidates;

    event Voted(address indexed voter, uint8 indexed candidateId);
    event VoterAdded(address indexed voter);
    event VoterRemoved(address indexed voter);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier voteOpen() {
        require(block.timestamp >= startTime, "Vote has not started yet");
        require(block.timestamp < endTime, "Vote is closed");
        _;
    }

    modifier voteClosed() {
        require(block.timestamp >= endTime, "Vote is still open");
        _;
    }

    constructor(
        string[] memory candidateNames,
        uint256 startDelaySeconds,
        uint256 durationSeconds
    ) {
        require(candidateNames.length >= 2, "At least 2 candidates required");
        require(durationSeconds > 0, "Duration must be greater than zero");

        owner = msg.sender;
        startTime = block.timestamp + startDelaySeconds;
        endTime = startTime + durationSeconds;

        for (uint8 i = 0; i < candidateNames.length; i++) {
            candidates.push(Candidate({id: i, voteCount: 0}));
        }
    }

    function addVoter(address voter) external onlyOwner {
        require(block.timestamp < startTime, "Voting already started");
        whitelist[voter] = bytes1(0x01);
        emit VoterAdded(voter);
    }

    function removeVoter(address voter) external onlyOwner {
        require(block.timestamp < startTime, "Voting already started");
        whitelist[voter] = bytes1(0x00);
        emit VoterRemoved(voter);
    }

    function isWhitelisted(address voter) public view returns (bool) {
        return whitelist[voter] == bytes1(0x01);
    }

    function hasUserVoted(address voter) public view returns (bool) {
        return hasVoted[voter] == bytes1(0x01);
    }

    function vote(uint8 candidateId) external voteOpen {
        require(isWhitelisted(msg.sender), "You are not authorized to vote");
        require(!hasUserVoted(msg.sender), "You have already voted");
        require(candidateId < candidates.length, "Invalid candidate");

        hasVoted[msg.sender] = bytes1(0x01);
        candidates[candidateId].voteCount += 1;

        emit Voted(msg.sender, candidateId);
    }

    function candidatesCount() external view returns (uint8) {
        return uint8(candidates.length);
    }

    function getResults() external view returns (uint8[] memory) {
        uint8[] memory res = new uint8[](candidates.length);
        for (uint8 i = 0; i < candidates.length; i++) {
            res[i] = candidates[i].voteCount;
        }
        return res;
    }

    function getCandidates() external view returns (uint8[] memory) {
        uint8[] memory ids = new uint8[](candidates.length);
        for (uint8 i = 0; i < candidates.length; i++) {
            ids[i] = candidates[i].id;
        }
        return ids;
    }

    function isOpen() public view returns (bool) {
        return block.timestamp >= startTime && block.timestamp < endTime;
    }
}
