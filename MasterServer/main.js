const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const WSS = require("ws");
const http = require("http")
const crypto = require("crypto");
const rng = require("./rng");
const protocol = require("./protocol");
const GameServer = require("./gameserver");
const GameClient = require("./client");
const { MongoClient } = require("mongodb");
require('dotenv').config({ path: '/home/ubuntu/dinorr/.env' })

const app = express();

const port = 55554;
const namespace = "/api";
const dbName = 'rrolf';

const DIRECTORY_SECRET = process.env.DIRECTORY_SECRET;
const PASSWORD_SALT = process.env.PASSWORD_SALT;
const CLOUD_TOKEN = process.env.CLOUD_TOKEN;
const NAMESPACE_ID = process.env.NAMESPACE_ID;
const SERVER_SECRET = process.env.SERVER_SECRET;
const uri = process.env.DB_URI;

let database = {accounts: [], links: []};
let changed = false;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

const databaseFilePath = path.join(__dirname, "database.json");

if (fs.existsSync(databaseFilePath))
{
    const databaseData = fs.readFileSync(databaseFilePath, "utf8");
    try {
        database = JSON.parse(databaseData);
        if (Array.isArray(database)) database = {accounts: [], links: []}; // remove after first run
    } catch(e) {
        database = {};
    }
}

const hash = s => crypto.createHash("sha512").update(s, "utf8").digest("hex");

app.use(cors());

const allowedOrigins = ['https://dinorr.fun', 'https://rwar.fun'];
app.use(function (req, res, next) {
    res.setHeader("X-Powered-By", "custom rrolf http server written in c")
    // allow only dinorr.fun and rwar.fun
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    next();
});

function is_valid_uuid(uuid)
{
    return uuid.length === 36 && uuid.match(/[0-9a-z]{8}-([0-9a-z]{4}-){3}[0-9a-z]{12}/) !== null;
}

function log(type, args, color = 31)
{
    // todo: save to some sort of log file
    console.log(`\u001b[${color}[${new Date().toJSON()}::[${type}]:\t${args.join("\t")}\u001b[0m`);
}

function get_rivet_url(key)
{
    return `https://kv.api.rivet.gg/v1/entries?namespace_id=${NAMESPACE_ID}&key=${key}`;
}

async function request(method, key, body)
{
    const url = get_rivet_url(key);
    const data_j = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${CLOUD_TOKEN}`
        },
        body: (() => {
            if (method !== "GET")
            {
                return JSON.stringify({
                    namespace_id: NAMESPACE_ID,
                    key,
                    value: body
                });
            }
        })()
    });
    if (method === "POST")
        return;
    try {
        const data = await data_j.json();
        return data;
    }
    catch (e) {
        console.log(e, data_j);
        return {};
    }
}

function apply_missing_defaults(account) {
    const defaults = {
        password: "",
        username: "",
        xp: 0,
        already_playing: 0,
        petals: { "1:0": 5 },
        failed_crafts: {},
        mob_gallery: {},
        user_playing: 0 // Adding 'user_playing' to the defaults
    };

    // Fill in any missing defaults
    for (const prop in defaults) {
        if (!account.hasOwnProperty(prop)) {
            account[prop] = defaults[prop];
        }
    }

    // Remove any extra properties
    for (const prop in account) {
        if (!defaults.hasOwnProperty(prop)) {
            delete account[prop];
        }
    }

    if (account.inflated_up_to < MAX_PETAL_COUNT)
    {
        log("inflated acc", [account.username]);
        for (let i = account.inflated_up_to; i < MAX_PETAL_COUNT; i++)
        {
            account.failed_crafts[`${i}:0`] = Math.max(4, account.failed_crafts[`${i}:0`] || 0); //  guarantee
            account.failed_crafts[`${i}:1`] = Math.max(4, account.failed_crafts[`${i}:1`] || 0); //  47.5%
            account.failed_crafts[`${i}:2`] = Math.max(6, account.failed_crafts[`${i}:2`] || 0); //  19.3%
            account.failed_crafts[`${i}:3`] = Math.max(8, account.failed_crafts[`${i}:3`] || 0); //  3.04%
            account.failed_crafts[`${i}:4`] = Math.max(10, account.failed_crafts[`${i}:4`] || 0); // 1.38%
        }
        account.inflated_up_to = MAX_PETAL_COUNT;
    }
    return account;
}

async function write_db_entry(username, data) {

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('users');

        await collection.updateOne({ username: username }, { $set: data }, { upsert: true });

        console.log("Database entry written successfully.");
    } catch (error) {
        console.error("Error writing to database:", error);
    } finally {
        // client.close();
    }
}


async function db_read_user(username, password) {

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('users');

        const user = await collection.findOne({ username: username });

        if (!user) {
            return null;
        }

        if (password !== user.password) {
            return null;
        }

        return user;
    } catch (error) {
        console.error("Error reading user from database:", error);
        return null;
    } finally {
        // client.close();
    }
}

async function db_read_or_create_user(username, password) {

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('users');

        let user = await collection.findOne({ username: username });

        if (!user) {
            console.log("Account create:", username);
            const newUser = apply_missing_defaults({ username: username });
            newUser.password = hash(username + PASSWORD_SALT);
            await collection.insertOne(newUser);
            return newUser;
        } else {
            apply_missing_defaults(user);
            return user;
        }
    } catch (error) {
        console.error("Error reading or creating user from database:", error);
        return null;
    } finally {
        // client.close();
    }
}

// Octobober 19, 2023 = 102923
function get_today()
{
    const date = new Date();
    
    const day = String(date.getDate()).padStart(2, '0'); // Day with leading zeros
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-based
    const year = String(date.getFullYear()).slice(-2); // Last two digits of year

    return `${month}${day}${year}`;
}

function get_unique_petals(petals)
{
    petals = structuredClone(petals);
    for (key in petals)
        petals[key] = 1;
    return petals;
}

async function db_append_petals_to_logs(petals)
{
    // const today = get_today();
    // let entry = (await request("GET", `${DIRECTORY_SECRET}/game/logs/${today}`)).value;
    // if (!entry)
    // {
    //     console.log("new day");
    //     const data = {
    //         games_played: 1,
    //         build_contains: get_unique_petals(petals),
    //         build_sum: structuredClone(petals) 
    //     };
    //     await request("PUT", `${DIRECTORY_SECRET}/game/logs/${today}`, data);
    //     return;
    // }

    // if (entry["7:3"] && today == "102923")
    // {
    //     console.log("wipe");
    //     entry = {games_played: 0, build_sum: {}, build_contains: {}};
    // }

    // entry.games_played++;

    // merge_petals(entry.build_sum, petals);
    // merge_petals(entry.build_contains, get_unique_petals(petals));
    // await request("PUT", `${DIRECTORY_SECRET}/game/logs/${today}`, entry);
}

function merge_petals(obj1, obj2) {
    for (let key in obj2) {
        if (obj1[key]) {
            obj1[key] += obj2[key];
        } else {
            obj1[key] = obj2[key];
        }
    }
}

async function handle_error(res, cb)
{
    try
    {
        res.end(await cb());
    }
    catch (e)
    {
        console.log(e);
        res.end("\x00" + e.stack);
    }
}

app.get(`${namespace}/account_link/:old_username/:old_password/:username/:password`, async (req, res) => {
    const {old_username, old_password, username, password} = req.params;
    handle_error(res, async () => {
        if (old_username === username)
            return "same uuid linkage not valid";
        if (!is_valid_uuid(old_username) || !is_valid_uuid(username))
            return "invalid uuid";
        const old_account = await db_read_user(old_username, old_password);
        if (!old_account)
        {
            return "failed";
        }
        const new_account = await db_read_user(username, password);
        database.links.push([old_username, username, old_account, new_account]);
        changed = true;
        if (!new_account || (new_account.xp * 3 <= old_account.xp))
        {
            log("account_link", [old_username, username]);
            old_account.linked_from = {...old_account};
            old_account.password = hash(username + PASSWORD_SALT);
            old_account.username = username;
            connected_clients[username] = old_account;
            await write_db_entry(username, old_account);
            await write_db_entry(old_username, null);
            delete connected_clients[username];
        }
        else
        {
            log("account_login", [old_username, username, new_account.xp, old_account.xp]);
        }
        return "success";
    });
});
  

app.get(`${namespace}/user_get_password/:password`, async (req, res) => {
    const {password} = req.params;
    handle_error(res, async () => {
        const d = await fetch("https://api.rivet.gg/identity/identities/self/profile", {
            headers: {
                Authorization: "Bearer " + password
            }
        });
        if (d.status != 200)
            throw new Error(JSON.stringify(await d.text()));
        const j = await d.json();
        return hash(j.identity.identity_id + PASSWORD_SALT);
    });
});

app.get(`${namespace}/user_get_server_alias/:alias`, async (req, res) => {
    const {alias} = req.params;
    handle_error(res, async () => {
        if (game_servers[alias])
            return game_servers[alias].rivet_server_id;
        else
            return '';
    });
});


app.use((req, res) => {
    res.status(404).send("404 Not Found\n");
});

async function saveDB(username) {

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('users');

        const user = database[username];
        if (!user) {
            console.error("User not found:", username);
            return;
        }

        const existingUser = await collection.findOne({ username: username });

        if (existingUser) {
            const updatedUser = { ...existingUser, ...user };
            await collection.updateOne({ username: username }, { $set: updatedUser });
            console.log("User updated:", username);
        } else {
            await collection.insertOne(user);
            console.log("User inserted:", username);
        }
    } catch (error) {
        console.error("Error saving user to MongoDB:", error);
    } finally {
        // client.close();
    }
}


const server = http.createServer(app);

server.listen(port, () => {
    console.log(`Server running at https://localhost:${port}`);
});

const wss = new WSS.Server({server});
const game_servers = {};
const connected_clients = {};

wss.on("connection", (ws, req) => {
    if (req.url !== `/api/${SERVER_SECRET}`)
       return ws.close();
    const game_server = new GameServer();
    game_server[game_server.alias] = game_server;
    ws.on('message', async (message) => {
        const data = new Uint8Array(message);
        const decoder = new protocol.BinaryReader(data);
        switch(decoder.ReadUint8())
        {
            case 0:
            {
                const uuid = decoder.ReadStringNT();
                const pos = decoder.ReadUint8();
                log("attempt init", [uuid]);
                if (!is_valid_uuid(uuid) || connected_clients[uuid])
                {
                    log("player force disconnect", [uuid]);
                    const encoder = new protocol.BinaryWriter();
                    encoder.WriteUint8(2);
                    encoder.WriteUint8(pos);
                    encoder.WriteStringNT(uuid);
                    ws.send(encoder.data.subarray(0, encoder.at));
                    break;
                }
                try {
                    const user = await db_read_or_create_user(uuid, SERVER_SECRET);
                    connected_clients[uuid] = new GameClient(user, game_server.alias);
                    game_server.clients[pos] = uuid;
                    const encoder = new protocol.BinaryWriter();
                    encoder.WriteUint8(1);
                    encoder.WriteUint8(pos);
                    connected_clients[uuid].write(encoder);
                    ws.send(encoder.data.subarray(0, encoder.at));
                } catch(e) {
                    console.log(e);
                }
                break;
            }
            case 1:
            {
                const uuid = decoder.ReadStringNT();
                if (connected_clients[uuid] && connected_clients[uuid].server !== game_server.alias)
                    break;
                const pos = game_server.clients.indexOf(uuid);
                if (pos !== -1)
                {
                    log("client delete", [uuid]);
                    const client = connected_clients[uuid];
                    if (!client)
                        break;
                    write_db_entry(client.user.username, client.user);
                    game_server.clients[pos] = 0;
                }
                delete connected_clients[uuid];
                break;
            }
            case 2:
            {
                const uuid = decoder.ReadStringNT();
                if (!connected_clients[uuid])
                    break;
                if (connected_clients[uuid] && connected_clients[uuid].server !== game_server.alias)
                    break;
                const user = connected_clients[uuid].user;
                user.xp = decoder.ReadFloat64();
                user.petals = {};
                user.failed_crafts = {};
                let id = decoder.ReadUint8();
                while (id)
                {
                    const rarity = decoder.ReadUint8();
                    const count = decoder.ReadVarUint();
                    user.petals[id+':'+rarity] = count;
                    id = decoder.ReadUint8();
                }
                id = decoder.ReadUint8();
                while (id)
                {
                    const rarity = decoder.ReadUint8();
                    const count = decoder.ReadVarUint();
                    user.failed_crafts[id+':'+rarity] = count;
                    id = decoder.ReadUint8();
                }
                await write_db_entry(uuid, user);
                break;
            }
            case 3:
            {
                let petals = {};
                let id = decoder.ReadUint8();
                while (id) {
                    let rarity = decoder.ReadUint8();
                    petals[`${id}:${rarity}`] = petals[`${id}:${rarity}`] || 0;
                    petals[`${id}:${rarity}`]++;
                    id = decoder.ReadUint8();
                }

                db_append_petals_to_logs(petals);
                break;
            }
            case 101:
                game_server.rivet_server_id = decoder.ReadStringNT();
                log("server id recv", [game_server.rivet_server_id]);
                break;
        }
    });
    log("game connect", [game_server.alias]);
    game_servers[game_server.alias] = game_server;
    const encoder = new protocol.BinaryWriter();
    encoder.WriteUint8(0);
    encoder.WriteStringNT(game_server.alias);
    ws.send(encoder.data.subarray(0, encoder.at));
    ws.on('close', async () => {
        log("game disconnect", [game_server.alias]);
        for (const uuid of game_server.clients)
        {
            if (connected_clients[uuid] && connected_clients[uuid].server === game_server.alias)
                await write_db_entry(uuid, connected_clients[uuid].user);
            delete connected_clients[uuid];
        }
        delete game_servers[game_server.alias];
    });
});

let quit = false;
const try_save_exit = () =>
{
   if (!quit)
   {
       quit = true;
       saveDB();
   }
   process.exit();
}

for (const error of ["beforeExit", "exit", "SIGTERM", "SIGINT", "uncaughtException"])
    process.on(error, args => { console.log(error, args); try_save_exit() });

setInterval(saveDB, 1000);

setInterval(() =>  {
    log("player count", [Object.keys(connected_clients).length]);
}, 15000);
