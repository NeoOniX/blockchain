// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Vote {
    struct Candidate {
        string name;
        uint256 voteCount;
    }

    enum Status {
        OPEN,
        CLOSED
    }

    address public owner;
    Status public status = Status.OPEN;

    mapping(address => bool) public hasVoted;
    Candidate[] public candidates;

    event Voted(address indexed voter, uint256 indexed candidateIndex);
    event StatusChanged(Status newStatus);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier isOpen() {
        require(status == Status.OPEN, "Vote is closed");
        _;
    }

    constructor(string[] memory candidateNames) {
        require(candidateNames.length >= 2, "Au moins 2 candidats");
        owner = msg.sender;
        status = Status.OPEN;

        for (uint256 i = 0; i < candidateNames.length; i++) {
            require(bytes(candidateNames[i]).length > 0, "Nom vide");
            candidates.push(Candidate({name: candidateNames[i], voteCount: 0}));
        }
    }

    function vote(uint candidateIndex) external isOpen {
        require(!hasVoted[msg.sender], unicode"Vous avez déjà voté !");
        require(candidateIndex < candidates.length, "Candidat invalide");

        hasVoted[msg.sender] = true;
        candidates[candidateIndex].voteCount += 1;

        emit Voted(msg.sender, candidateIndex);
    }

    // ADMIN FUNCTIONS

    function close() external onlyOwner {
        require(status == Status.OPEN, unicode"Vote déjà fermé");
        status = Status.CLOSED;
        emit StatusChanged(status);
    }

    function open() external onlyOwner {
        require(status == Status.CLOSED, unicode"Vote déjà ouvert");
        status = Status.OPEN;
        emit StatusChanged(status);
    }

    //HELPER FUNCTIONS

    function candidatesCount() external view returns (uint256) {
        return candidates.length;
    }

    function getResults() external view returns (uint256[] memory) {
        uint256[] memory res = new uint256[](candidates.length);
        for (uint256 i = 0; i < candidates.length; i++) {
            res[i] = candidates[i].voteCount;
        }
        return res;
    }

    function getCandidates() external view returns (Candidate[] memory) {
        return candidates;
    }
}
