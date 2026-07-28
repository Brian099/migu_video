import fs from "node:fs";
import path from "node:path";

let cachedLogos = null;

// 规整化频道名称，用于模糊/不区分大小写匹配
function normalizeChannelName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/综合/g, "")
    .replace(/频道/g, "")
    .replace(/高清/g, "")
    .replace(/超清/g, "")
    .replace(/测试/g, "")
    .replace(/备用/g, "")
    .replace(/hd/g, "")
    .replace(/265/g, "")
    .replace(/[\s\-_]+/g, "");
}

// 缓存 channel_logo 目录下的所有支持的图片文件
function initLogoCache() {
  const logoDir = path.join(process.cwd(), "channel_logo");
  cachedLogos = {}; // 存储 规整化名称 -> 真实文件名 的映射
  if (fs.existsSync(logoDir)) {
    try {
      const files = fs.readdirSync(logoDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") {
          const baseName = path.basename(file, ext);
          const normalized = normalizeChannelName(baseName);
          cachedLogos[normalized] = file;
        }
      }
    } catch (e) {
      console.error("读取 channel_logo 目录失败", e);
    }
  }
}

/**
 * 获取台标地址
 * @param {string} channelName 频道/赛事名称
 * @param {string} fallbackUrl 咪咕默认台标
 * @param {boolean} useReplacePlaceholder 是否使用 ${replace} 占位符
 */
export function getLogoUrl(channelName, fallbackUrl, useReplacePlaceholder = true) {
  if (cachedLogos === null) {
    initLogoCache();
  }
  
  const normalized = normalizeChannelName(channelName);
  
  // 1. 尝试完全/规整化匹配
  let matchedFile = cachedLogos[normalized] || null;
  
  // 2. 针对 CCTV 频道进行前缀提取匹配（例如：CCTV16奥林匹克 -> 提取 cctv16 -> 匹配 CCTV16.png）
  if (!matchedFile && normalized.startsWith("cctv")) {
    const cctvMatch = normalized.match(/^cctv(\d+\+?|[a-z]+)/);
    if (cctvMatch) {
      const cctvKey = cctvMatch[0];
      matchedFile = cachedLogos[cctvKey] || null;
    }
  }
  
  // 如果找到本地台标，返回包含本地链接
  if (matchedFile) {
    const encodedFile = encodeURIComponent(matchedFile);
    if (useReplacePlaceholder) {
      return `\${replace}/channel_logo/${encodedFile}`;
    } else {
      return `/channel_logo/${encodedFile}`;
    }
  }
  
  // 匹配不上，返回默认的咪咕台标
  return fallbackUrl || "";
}

export function clearLogoCache() {
  cachedLogos = null;
}
