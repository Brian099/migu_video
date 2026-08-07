import http from "node:http"
import { host, pass, port, programInfoUpdateInterval, token, userId } from "./config.js";
import { getDateTimeStr } from "./utils/time.js";
import update from "./utils/updateData.js";
import { printBlue, printGreen, printMagenta, printRed } from "./utils/colorOut.js";
import { delay } from "./utils/fetchList.js";
import { channel, interfaceStr } from "./utils/appUtils.js";

// 运行时长
var hours = 0

const server = http.createServer(async (req, res) => {
  // 获取请求方法、URL 和请求头
  let { method, url, headers } = req;

  // 剥离 URL 中的 Query 参数
  let searchParams = new URLSearchParams();
  const queryIndex = url.indexOf("?");
  if (queryIndex !== -1) {
    searchParams = new URLSearchParams(url.substring(queryIndex + 1));
    url = url.substring(0, queryIndex);
  }

  // 身份认证
  if (pass != "") {
    // 排除前台静态页面、检测配置接口和本地台标静态资源，由前端页面和播放器直接拉取
    if (url !== "/" && url !== "/index.html" && url !== "/admin" && url !== "/api/config" && !url.startsWith("/channel_logo/")) {
      const urlSplit = url.split("/")
      if (urlSplit[1] != pass) {
        printRed(`身份认证失败`)
        res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
        res.end(`身份认证失败`); // 发送文件内容
        return
      } else {
        printGreen("身份认证成功")
        // 有密码且传入用户信息
        if (urlSplit.length > 3) {
          url = url.substring(pass.length + 1)
        } else {
          url = urlSplit.length == 2 ? "/" : "/" + urlSplit[urlSplit.length - 1]
        }
      }
    }
  }

  // 静态台标文件服务
  const logoIndex = url.indexOf("/channel_logo/");
  if (logoIndex !== -1) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filename = path.basename(decodeURIComponent(url.substring(logoIndex + 14)));
    const filePath = path.join(process.cwd(), "channel_logo", filename);

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      let contentType = "image/png";
      if (ext === ".jpg" || ext === ".jpeg") {
        contentType = "image/jpeg";
      } else if (ext === ".webp") {
        contentType = "image/webp";
      }
      
      try {
        const fileContent = fs.readFileSync(filePath);
        res.writeHead(200, { "Content-Type": contentType });
        res.end(fileContent);
        return;
      } catch (err) {
        printRed(`读取台标文件失败: ${filename}`);
        console.error(err);
      }
    }
    
    res.writeHead(404, { "Content-Type": "text/plain;charset=UTF-8" });
    res.end("台标文件不存在");
    return;
  }

  // 静态前台页面托管
  if (url === "/" || url === "/index.html" || url === "/admin") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), "public", "index.html");
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "text/html;charset=UTF-8" });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain;charset=UTF-8" });
      res.end("index.html 文件未找到，请检查项目目录结构");
    }
    return;
  }

  // 配置探测 API (免密)
  if (url === "/api/config" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json;charset=UTF-8" });
    res.end(JSON.stringify({ needsPass: pass !== "" }));
    return;
  }

  // 1. 获取频道数据 API
  if (url === "/api/channels" && method === "GET") {
    const fs = await import("node:fs");
    const filePath = `${process.cwd()}/interface.txt`;
    let channels = [];
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      let currentChannel = null;
      for (let line of lines) {
        line = line.trim();
        if (line.startsWith("#EXTINF:")) {
          const nameMatch = line.match(/,(.+)$/);
          const logoMatch = line.match(/tvg-logo="([^"]*)"/);
          const groupMatch = line.match(/group-title="([^"]*)"/);
          currentChannel = {
            name: nameMatch ? nameMatch[1].trim() : "未知频道",
            logo: logoMatch ? logoMatch[1] : "",
            group: groupMatch ? groupMatch[1] : "其他"
          };
        } else if (line && !line.startsWith("#")) {
          if (currentChannel) {
            const idMatch = line.match(/\/([^/?]+)($|\?)/);
            currentChannel.id = idMatch ? idMatch[1] : "";
            currentChannel.playUrl = line;
            channels.push(currentChannel);
            currentChannel = null;
          }
        }
      }
    }
    res.writeHead(200, { "Content-Type": "application/json;charset=UTF-8" });
    res.end(JSON.stringify(channels));
    return;
  }

  // 2. 获取本地台标列表 API
  if (url === "/api/logos" && method === "GET") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const logoDir = path.join(process.cwd(), "channel_logo");
    let logos = [];
    if (fs.existsSync(logoDir)) {
      logos = fs.readdirSync(logoDir).filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp";
      });
    }
    res.writeHead(200, { "Content-Type": "application/json;charset=UTF-8" });
    res.end(JSON.stringify(logos));
    return;
  }

  // 3. 上传台标 API
  if (url === "/api/upload-logo" && method === "POST") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { clearLogoCache } = await import("./utils/logoUtil.js");

    const rawFilename = req.headers["x-filename"];
    if (!rawFilename) {
      res.writeHead(400, { "Content-Type": "application/json;charset=UTF-8" });
      res.end(JSON.stringify({ error: "请求头中缺少 x-filename" }));
      return;
    }

    const filename = path.basename(decodeURIComponent(rawFilename));
    const targetPath = path.join(process.cwd(), "channel_logo", filename);
    const writeStream = fs.createWriteStream(targetPath);
    req.pipe(writeStream);

    writeStream.on("finish", () => {
      clearLogoCache();
      res.writeHead(200, { "Content-Type": "application/json;charset=UTF-8" });
      res.end(JSON.stringify({ success: true, filename }));
    });

    writeStream.on("error", (err) => {
      console.error("写入文件失败", err);
      res.writeHead(500, { "Content-Type": "application/json;charset=UTF-8" });
      res.end(JSON.stringify({ error: "上传台标失败" }));
    });
    return;
  }

  // 4. 删除台标 API
  if (url === "/api/delete-logo" && method === "DELETE") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { clearLogoCache } = await import("./utils/logoUtil.js");

    const query = new URL(req.url, "http://localhost").searchParams;
    const filename = query.get("name");

    if (!filename) {
      res.writeHead(400, { "Content-Type": "application/json;charset=UTF-8" });
      res.end(JSON.stringify({ error: "未指定删除的台标名称" }));
      return;
    }

    const safeFilename = path.basename(filename);
    const targetPath = path.join(process.cwd(), "channel_logo", safeFilename);

    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
        clearLogoCache();
        res.writeHead(200, { "Content-Type": "application/json;charset=UTF-8" });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error("删除文件失败", err);
        res.writeHead(500, { "Content-Type": "application/json;charset=UTF-8" });
        res.end(JSON.stringify({ error: "删除台标失败" }));
      }
    } else {
      res.writeHead(404, { "Content-Type": "application/json;charset=UTF-8" });
      res.end(JSON.stringify({ error: "台标文件不存在" }));
    }
    return;
  }

  let urlToken = ""
  let urlUserId = ""
  // 匹配是否存在用户信息 (如 /userId/token/pid)
  if (!url.startsWith("/api/") && !url.startsWith("/channel_logo/") && /\/{1}[^\/\s]{1,}\/{1}[^\/\s]{1,}/.test(url)) {
    const urlSplit = url.split("/")
    if (urlSplit.length >= 3) {
      urlUserId = urlSplit[1]
      urlToken = urlSplit[2]
      url = urlSplit.length == 3 ? "/" : "/" + urlSplit[urlSplit.length - 1]
    }
  } else {
    urlUserId = userId
    urlToken = token
  }

  // printGreen("")
  printMagenta("请求地址：" + url)

  if (method === "HEAD") {
    res.writeHead(200, {
      "Content-Type": "application/json;charset=UTF-8",
    });
    res.end();
    return;
  }

  if (method != "GET") {
    res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
    res.end(JSON.stringify({
      data: '请使用GET请求',
    }));
    printRed(`使用非GET请求:${method}`)
    return
  }

  const interfaceList = "/interface.txt,/m3u,/txt,/playback.xml"

  // 接口
  if (interfaceList.indexOf(url) !== -1) {
    const interfaceObj = interfaceStr(url, headers, urlUserId, urlToken, searchParams)
    if (interfaceObj.content == null) {
      interfaceObj.content = "获取失败"
    }
    // 设置响应头
    res.setHeader('Content-Type', interfaceObj.contentType);
    if (url == "/m3u") {
      res.setHeader('content-disposition', "inline; filename=\"interface.m3u\"");
    }
    res.statusCode = 200;
    res.end(interfaceObj.content); // 发送文件内容
    return;
  }

  let activeUserId = urlUserId;
  let activeToken = urlToken;
  let activeRateType = searchParams.get("rateType"); // 优先读取 URL 传递的画质

  // 频道
  const result = await channel(url, activeUserId, activeToken, activeRateType)

  // 结果异常
  if (result.code != 302) {

    printRed(result.desc)
    res.writeHead(result.code, {
      'Content-Type': 'application/json;charset=UTF-8',
    });
    res.end(result.desc)
    return;
  }

  res.writeHead(result.code, {
    'Content-Type': 'application/json;charset=UTF-8',
    location: result.playURL
  });

  res.end()
})

server.listen(port, async () => {
  const updateInterval = parseInt(programInfoUpdateInterval)
  // 更新
  setInterval(async () => {
    printBlue(`准备更新文件 ${getDateTimeStr(new Date())}`)
    hours += updateInterval
    try {
      await update(hours)
    } catch (error) {
      console.log(error)
      printRed("更新失败")
    }

    printBlue(`当前已运行${hours}小时`)
  }, updateInterval * 60 * 60 * 1000);

  try {
    // 初始化数据
    await update(hours)
  } catch (error) {
    console.log(error)
    printRed("更新失败")
  }

  printGreen(`本地地址: http://localhost:${port}${pass == "" ? "" : "/" + pass}`)
  printGreen(`本程序完全免费，如果您是通过付费渠道获取，那么恭喜你成功被骗了`)
  printGreen("开源地址: https://github.com/develop202/migu_video 欢迎issue 感谢star")
  if (host != "") {
    printGreen(`自定义地址: ${host}${pass == "" ? "" : "/" + pass}`)
  }
})
