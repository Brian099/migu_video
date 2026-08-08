import fs from "node:fs";
import path from "node:path";

// 初始默认配置（优先环境变量）
let userId = (process.env.muserId || "").trim();
let token = (process.env.mtoken || "").trim();
let rateType = parseInt(process.env.mrateType || 3);

const port = process.env.mport || 1234;
const host = (process.env.mhost || "").trim();
const debug = process.env.mdebug || false;
const pass = (process.env.mpass || "").trim();
const enableHDR = process.env.menableHDR || true;
const enableH265 = process.env.menableH265 || true;
const programInfoUpdateInterval = process.env.mupdateInterval || "6";
const ignoreCategory = process.env.mignoreCategory || null;
const mergeTVCategory = process.env.mmergeTVCategory || true;
const customMergeCategory = process.env.mcustomMergeCategory || null;

// 读取持久化文件 data/user_config.json
function loadUserConfigFromFile() {
  try {
    const configPath = path.join(process.cwd(), "data", "user_config.json");
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (data.userId !== undefined) userId = String(data.userId).trim();
      if (data.token !== undefined) token = String(data.token).trim();
      if (data.rateType !== undefined) rateType = parseInt(data.rateType) || 3;
    }
  } catch (e) {
    console.error("读取 user_config.json 失败:", e);
  }
}

// 保存持久化文件并同步更新 ES 模块变量
function saveUserConfig(newConfig) {
  try {
    if (newConfig.userId !== undefined) userId = String(newConfig.userId).trim();
    if (newConfig.token !== undefined) token = String(newConfig.token).trim();
    if (newConfig.rateType !== undefined) rateType = parseInt(newConfig.rateType) || 3;

    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const configPath = path.join(dataDir, "user_config.json");
    fs.writeFileSync(configPath, JSON.stringify({ userId, token, rateType }, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("保存 user_config.json 失败:", e);
    return false;
  }
}

// 模块加载时自动读取
loadUserConfigFromFile();

export {
  userId,
  token,
  port,
  host,
  rateType,
  debug,
  pass,
  enableHDR,
  programInfoUpdateInterval,
  enableH265,
  ignoreCategory,
  mergeTVCategory,
  customMergeCategory,
  saveUserConfig
};
