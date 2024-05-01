class GameServer {
    constructor() {
        this.alias = "100";
        this.rivet_server_id = "no-uuid";
        this.clients = new Array(64).fill(0);
        this.alias = (parseInt(this.alias, 36) + 1).toString(36);
    }
}

module.exports = GameServer;
