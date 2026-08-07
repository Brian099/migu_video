import { get302URL, getAndroidURL, getAndroidURL720p, printLoginInfo } from "./androidURL.js";
import { readFileSync } from "./fileUtil.js";
import { host, pass, rateType, token, userId } from "../config.js";
import { printDebug, printGreen, printGrey, printRed, printYellow } from "./colorOut.js";
import fs from "node:fs";

// url缓存 降低请求频率
const urlCache = {}

function interfaceStr(url, headers, urlUserId, urlToken, searchParams) {

  let result = {
    content: null,
    contentType: 'text/plain;charset=UTF-8'
  }
  let fileName = process.cwd() + "/interface.txt"
  switch (url) {
    case "/playback.xml":
      fileName = process.cwd() + "/playback.xml"
      result.contentType = "text/xml;charset=UTF-8"
      break;

    case "/txt":
      fileName = process.cwd() + "/interfaceTXT.txt"
      break;

    case "/m3u":
      result.contentType = "audio/x-mpegurl; charset=utf-8"
      break;

    default:
      break;
  }
  try {
    result.content = readFileSync(fileName)
  } catch (error) {
    printRed("文件获取失败")
    console.log(error)
    return result
  }
  if (url == "/playback.xml") {
    return result
  }

  let content = `${result.content}`;

  // 1. 进行分组过滤 (优先取 URL query，其次取后台保存的分组配置 data/groups.json)
  let groupFilter = searchParams ? searchParams.get("group") : null;
  if (!groupFilter) {
    try {
      const configPath = `${process.cwd()}/data/groups.json`;
      if (fs.existsSync(configPath)) {
        const savedGroups = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (Array.isArray(savedGroups) && savedGroups.length > 0) {
          groupFilter = savedGroups.join(",");
        }
      }
    } catch (e) {}
  }

  if (groupFilter && groupFilter !== "全部") {
    if (url === "/m3u" || url.endsWith("interface.txt")) {
      content = filterM3UByGroup(content, groupFilter);
    } else if (url === "/txt" || url.endsWith("interfaceTXT.txt")) {
      content = filterTXTByGroup(content, groupFilter);
    }
  }

  // 2. 替换 Host 占位符
  let proto = "http";
  const forwardedProto = headers["x-forwarded-proto"];
  if (forwardedProto) {
    proto = forwardedProto.split(",")[0].trim();
  } else if (headers["x-scheme"]) {
    proto = headers["x-scheme"];
  } else if (headers["x-forwarded-ssl"] === "on") {
    proto = "https";
  }
  let replaceHost = `${proto}://${headers.host}`

  if (host != "" && (headers["x-real-ip"] || headers["x-forwarded-for"] || host.indexOf(headers.host) != -1)) {
    replaceHost = host
  }

  if (pass != "") {
    replaceHost = `${replaceHost}/${pass}`
  }

  if (urlUserId != userId && urlToken != token) {
    replaceHost = `${replaceHost}/${urlUserId}/${urlToken}`
  }

  content = content.replaceAll("${replace}", replaceHost);

  result.content = content;
  return result;
}

// M3U 过滤辅助函数
function filterM3UByGroup(content, targetGroup) {
  const targetGroups = targetGroup.split(',').map(g => g.trim()).filter(Boolean);
  if (targetGroups.length === 0) return content;

  const lines = content.split(/\r?\n/);
  const resultLines = [lines[0]]; // 保留 #EXTM3U 头部
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k].trim();
    if (line.startsWith("#EXTINF:")) {
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const group = groupMatch ? groupMatch[1] : "";
      if (targetGroups.includes(group)) {
        resultLines.push(line);
        if (k + 1 < lines.length) {
          resultLines.push(lines[k + 1].trim());
        }
      }
      k++; // 跳过紧随其后的 URL 行
    }
  }
  return resultLines.join("\n");
}

// TXT 过滤辅助函数
function filterTXTByGroup(content, targetGroup) {
  const targetGroups = targetGroup.split(',').map(g => g.trim()).filter(Boolean);
  if (targetGroups.length === 0) return content;

  const lines = content.split(/\r?\n/);
  const resultLines = [];
  let inGroup = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith(",#genre#")) {
      const groupName = trimmed.substring(0, trimmed.length - 8).trim();
      if (targetGroups.includes(groupName)) {
        inGroup = true;
        resultLines.push(line);
      } else {
        inGroup = false;
      }
    } else if (inGroup && trimmed) {
      resultLines.push(line);
    }
  }
  return resultLines.join("\n");
}

async function channel(url, urlUserId, urlToken, requestRateType) {

  let result = {
    code: 200,
    pID: "",
    desc: "服务异常",
    playURL: ""
  }
  // 处理频道ID
  let urlSplit = url.split("/")[1]
  let pid = urlSplit
  let params = ""

  // 处理回放参数
  if (urlSplit.match(/\?/)) {
    printGreen("处理传入参数")

    const urlSplit1 = urlSplit.split("?")
    pid = urlSplit1[0]
    params = urlSplit1[1]
  } else {
    printGrey("无参数传入")
  }

  if (isNaN(pid)) {
    result.desc = "地址格式错误"
    return result
  }

  printYellow("频道ID " + pid)

  // 决定当前请求的清晰度
  const currentRateType = requestRateType !== undefined && requestRateType !== null ? parseInt(requestRateType) : parseInt(rateType);

  // 构造独立缓存 Key (防止多账号或多画质数据互相覆盖)
  const cacheKey = `${pid}_${urlUserId || ""}_${currentRateType}`;

  // 是否存在缓存
  const cache = channelCache(cacheKey, params)
  if (cache.haveCache) {
    result.code = cache.code
    result.playURL = cache.playURL
    result.desc = cache.cacheDesc
    return result
  }

  let resObj = {}
  try {
    // 未登录请求720p
    if (currentRateType >= 3 && (urlUserId == "" || urlToken == "")) {
      resObj = await getAndroidURL720p(pid)
    } else {
      resObj = await getAndroidURL(urlUserId, urlToken, pid, currentRateType)
    }
  } catch (error) {
    console.log(error)
    result.desc = "链接请求出错"
    return result
  }
  printDebug(`添加加密字段后链接 ${resObj.url}`)

  printLoginInfo(resObj)
  printGreen(`添加节目缓存 ${cacheKey}`)
  // 缓存有效时长
  let addTime = 3 * 60 * 60 * 1000
  // 节目调整
  if (resObj.url == "") {
    addTime = 1 * 60 * 1000
  }
  // 加入缓存
  urlCache[cacheKey] = {
    valTime: Date.now() + addTime,
    url: resObj.url,
    content: resObj.content,
  }

  if (resObj.url == "") {
    let msg = resObj.content != null ? resObj.content.message : "节目调整，暂不提供服务"
    result.desc = `${pid} ${msg}`
    return result
  }
  let playURL = resObj.url

  // 添加回放参数
  if (params != "") {
    const resultParams = new URLSearchParams(params);
    for (const [key, value] of resultParams) {
      playURL = `${playURL}&${key}=${value}`
    }
  }

  printGreen("链接获取成功")
  result.code = 302
  result.playURL = playURL
  return result
}

function channelCache(cacheKey, params) {
  let cache = {
    haveCache: false,
    code: 200,
    pID: "",
    playURL: "",
    cacheDesc: ""
  }
  if (typeof urlCache[cacheKey] === "object") {
    const valTime = urlCache[cacheKey].valTime - Date.now()
    // 缓存是否有效
    if (valTime >= 0) {
      cache.haveCache = true
      let playURL = urlCache[cacheKey].url
      let msg = "节目调整，暂不提供服务"
      if (urlCache[cacheKey].content != null) {
        printLoginInfo(urlCache[cacheKey])
        msg = urlCache[cacheKey].content.message
      }
      // 节目调整
      if (playURL == "") {
        cache.cacheDesc = `${cacheKey.split("_")[0]} ${msg}`
        return cache
      }

      // 添加回放参数
      if (params != "") {
        const resultParams = new URLSearchParams(params);
        for (const [key, value] of resultParams) {
          playURL = `${playURL}&${key}=${value}`
        }
      }
      printGreen("使用缓存数据")
      cache.code = 302
      cache.cacheDesc = "缓存获取成功"
      cache.playURL = playURL
      return cache
    }
  }
  cache.cacheDesc = "暂无缓存"
  return cache
}

export { interfaceStr, channel, channelCache }
