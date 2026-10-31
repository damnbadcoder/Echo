import * as SQLite from "expo-sqlite";

export interface MessageRecord {
    id: string;  // unique message UUID
    peer_id: string; // conversation identifier (id of receiver of message {final receiver})
    sender: string; // identifier of the sender
    content: string;  // plaintext body of message
    timestamp: number; // unix timestamp in milliseconds
    status: "pending" | "relayed" | "delivered"; // status of the message
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function resetDatabase(): void {
    dbPromise = null;
}

/**
 * Initializes and returns the local SQLite database singleton.
 * Automatically executes table schema creation on first run with Promise-level mutex.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (!dbPromise) {
        dbPromise = (async () => {
            try {
                const db = await SQLite.openDatabaseAsync("chitchat.db");
                await db.execAsync(`
                    PRAGMA journal_mode = WAL;
                    CREATE TABLE IF NOT EXISTS messages(
                       id TEXT PRIMARY KEY NOT NULL,
                       peer_id TEXT NOT NULL,
                       sender TEXT NOT NULL,
                       content TEXT NOT NULL,
                       timestamp INTEGER NOT NULL,
                       status TEXT NOT NULL
                    );
                `);
                return db;
            } catch (err) {
                dbPromise = null;
                throw err;
            }
        })();
    }
    return dbPromise;
}

/**
 * Inserts a new sent or received message into the local messages table.
 */
export async function insertMessage(msg: MessageRecord): Promise<void> {
    const execute = async () => {
        const db = await getDatabase();
        await db.runAsync(
            `INSERT OR REPLACE INTO messages (id, peer_id, sender, content, timestamp, status)
             VALUES (?, ?, ?, ?, ?, ?);`,
            [msg.id, msg.peer_id, msg.sender, msg.content, msg.timestamp, msg.status]
        );
    };

    try {
        await execute();
    } catch (err) {
        console.warn('[store] insertMessage failed, resetting DB connection and retrying:', err);
        resetDatabase();
        await execute();
    }
}

/**
 * Retrieves all stored messages for a specific conversation peer,
 * ordered with newest messages first for inverted FlatList feeds.
 */
export async function getMessagesForPeer(peerId: string): Promise<MessageRecord[]> {
    const execute = async () => {
        const db = await getDatabase();
        return await db.getAllAsync<MessageRecord>(
            `SELECT * FROM messages WHERE peer_id = ? ORDER BY timestamp DESC;`,
            [peerId]
        );
    };

    try {
        return await execute();
    } catch (err) {
        console.warn('[store] getMessagesForPeer failed, resetting DB connection and retrying:', err);
        resetDatabase();
        try {
            return await execute();
        } catch (retryErr) {
            console.error('[store] getMessagesForPeer permanently failed:', retryErr);
            return [];
        }
    }
}

/**
 * Updates the delivery status tick for an existing message.
 */
export async function updateMessageStatus(
    id: string,
    status: "pending" | "relayed" | "delivered"
): Promise<void> {
    const execute = async () => {
        const db = await getDatabase();
        await db.runAsync(
            `UPDATE messages SET status = ? WHERE id = ?;`,
            [status, id]
        );
    };

    try {
        await execute();
    } catch (err) {
        console.warn('[store] updateMessageStatus failed, resetting DB connection and retrying:', err);
        resetDatabase();
        try {
            await execute();
        } catch (e) {
            console.error('[store] updateMessageStatus permanently failed:', e);
        }
    }
}




