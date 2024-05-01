const db = require("./database.json");
const DIRECTORY_SECRET = "a92pd3nf29d38tny9pr34dn3d908ntgb";
const CLOUD_TOKEN = "cloud.eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSJ9.CPa3_b7oMhD237iB8zEaEgoQPcAEh08wQsONiIplPiEAxSIWOhQKEgoQMkfVFW4YT7OS8TcsnIZDYA.TleO6GP_IiNX_P8cXi8lY5VHYv1zz54nDRgbRLeGQ2URXGyjkD9Ca_xQQI1xS8mLjCVK_ZyhzJpo6KkyAYcYDA";
const NAMESPACE_ID = "04cfba67-e965-4899-bcb9-b7497cc6863b";

function get_rivet_url(key)
{
    return `https://api.rivet.gg/kv/entries?namespace_id=${NAMESPACE_ID}&key=${key}`;
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
                let json = {
                    namespace_id: NAMESPACE_ID,
                    key,
                    value: body
                };

                return JSON.stringify(json);
            }
        })()
    });

    console.log(await data_j.text());

    // const data = await data_j.json();
    // return data;
}

const element_count = Object.keys(db).length;

let c = 0;
const processEntries = async (entries) => {
    const promises = entries.map(async (key) => {
        const entry = db[key];
        if (entry.maximum_wave > 28)
            entry.maximum_wave = 28;
        await request("PUT", `${DIRECTORY_SECRET}/game/players/${key}`, entry);
        console.log(`[${(performance.now() / 1000).toFixed(2)}]finished: ${++c}/${element_count}`, key);
    });

    return Promise.all(promises);
};

(async () => {
    const keys = Object.keys(db);
    for (let i = 0; i < keys.length; i += 60) {
        const chunk = keys.slice(i, i + 60);
        await processEntries(chunk);
    }
})();