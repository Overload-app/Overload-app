// Tester passwords, one per tester, each locked to the device(s) it's first
// used on. Real ask: "a list of 15 testers, each with their own password; once
// a password is used, it only works on that device from then on" — for
// testers found on Instagram.
//
// Only SHA-256 hashes live here; the passwords themselves are in the owner's
// private tester-passwords.txt (never committed). Which devices each tester
// has used is kept in the tester_devices table
// (supabase-migration-tester-devices.sql). Until that table exists the
// passwords still work, just without the device lock.
//
// Two devices per tester, not one: on iPhone, Safari and the Home Screen app
// keep separate storage, so a tester who unlocks in Safari and then adds the
// app to their Home Screen looks like a second device. To free a tester's
// slots (new phone), run in Supabase: delete from tester_devices where tester = 3;
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const TESTER_PASSWORD_HASHES = {"1": "ac4895ca7453043f9832f2d1c75a0b14d935146092125f0d9fb31afd3e49311e", "2": "b8a31210fdf299aca9da7a2088bfb54617888c679195b1cf7e0257f574c65d14", "3": "96f3bea28e3a32060cba889b3f276cc30aa15282b1082adf202f6fcb4c54a532", "4": "219a2e3fcec0078e42aa16b6769c46a18e3da2e094726f958fbe8f94f2193225", "5": "0adb8d919fa7eb679ad9a8273403ad228f4ddd84d95a66867b0e303d727f1170", "6": "d93a06506522426c12f12a5099dd25cb8a67b7f4212e997f7bd71058ad167674", "7": "9385489f94722d9758ade1b30a363f370a4f345286ab34385e62323ffd6e4c9d", "8": "4633d96006c5eb0c4aeaefc16225da0f480323d78982d85ddb120ef99be31d52", "9": "5bff49c733dd9ebe021bfc17ba1fe9492adda66b8ddfe5b9eb40599a84fba754", "10": "35b565105945bf899840a476580135b59aab286eeb6c618baf3bf32180428756", "11": "93036352b29744cdc41f1d4c6aeec6b476ce20be4c6c21d6fea6512603753ecb", "12": "437efb2a7a806797314f2e76fa45f85cca51118028c6f1a56314a2a01ad901af", "13": "bb44cde20ccb0698e534d80157f559f20302c2ac1879a798a50801a163285af5", "14": "58b26403c7eef6f4d9199bbc0a984cc624e2b61950aa5ab5d7ab001a400c646c", "15": "f2623f86a55c9cad309bd8a3c23de84906cb36bc851dc576cbde5f020bbf1b25"};
export const MAX_DEVICES_PER_TESTER = 2;

export function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "").trim()).digest("hex");
}

export function passwordMatches(tester, password) {
  const expected = TESTER_PASSWORD_HASHES[String(tester)];
  if (!expected) return false;
  const got = hashPassword(password);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Wrong guesses, per caller, kept in memory: enough to stop someone trying
// passwords in a loop.
const attempts = new Map();
export function tooManyAttempts(ip, now = Date.now(), map = attempts) {
  const recent = (map.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  map.set(ip, recent);
  return recent.length >= 10;
}
function noteFailure(ip, now = Date.now(), map = attempts) {
  map.set(ip, [...(map.get(ip) || []), now]);
}

// What to do with this device, given the devices already recorded.
export function deviceDecision(devices, deviceId) {
  if (devices.includes(deviceId)) return "known";
  if (devices.length < MAX_DEVICES_PER_TESTER) return "add";
  return "full";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ip = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooManyAttempts(ip)) return res.status(429).json({ error: "Too many tries — wait a few minutes and try again." });

  const tester = Number(req.body?.tester);
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.slice(0, 64) : "";
  if (!Number.isInteger(tester) || !deviceId || !passwordMatches(tester, req.body?.password)) {
    noteFailure(ip);
    return res.status(401).json({ error: "That's not the right password for that tester." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return res.status(200).json({ ok: true, locked: false });
  const db = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await db.from("tester_devices").select("device_id").eq("tester", tester);
  if (error) return res.status(200).json({ ok: true, locked: false }); // table not set up yet
  const decision = deviceDecision((data || []).map((r) => r.device_id), deviceId);
  if (decision === "full") {
    return res.status(403).json({ error: "This tester password is already being used on another device. Message the Overload account if you've switched phones." });
  }
  if (decision === "add") {
    await db.from("tester_devices").insert({ tester, device_id: deviceId, claimed_at: new Date().toISOString() });
  }
  return res.status(200).json({ ok: true, locked: true });
}
