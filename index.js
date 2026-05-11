const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer-core");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const BROWSERLESS_KEY       = "2UUU9ks8ljiUIFPef1975f4001009046682ef4aaa174d1f20";

async function gonderiGetir(gonderiNo) {
  let browser = null;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io/chromium?token=${BROWSERLESS_KEY}`,
    });
    const page = await browser.newPage();
    await page.setDefaultTimeout(60000);
    await page.goto("https://kurumsal.kolaygelsin.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await bekle(1000);
    await page.evaluate((k, s) => {
      const inp = document.querySelectorAll("input");
      if (inp[0]) { inp[0].value = k; inp[0].dispatchEvent(new Event("input", { bubbles: true })); }
      if (inp[1]) { inp[1].value = s; inp[1].dispatchEvent(new Event("input", { bubbles: true })); }
    }, KOLAYGELSIN_KULLANICI, KOLAYGELSIN_SIFRE);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(b => b.type === "submit" || b.innerText?.toLowerCase().includes("giriş") || b.innerText?.toLowerCase().includes("giris"));
      if (btn) btn.click();
    });
    await bekle(3000);
    await page.goto("https://kurumsal.kolaygelsin.com/pages/shipments/shipmentTrack", { waitUntil: "domcontentloaded", timeout: 30000 });
    await bekle(1500);
    await page.evaluate((no) => {
      const inp = document.querySelector('input[type="text"]');
      if (inp) { inp.value = no; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); }
    }, gonderiNo);
    await bekle(500);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.toLowerCase().includes("filtrele"));
      if (b) b.click();
    });
    await bekle(3000);
    await page.evaluate(() => { const s = document.querySelectorAll("tbody tr"); if (s.length > 0) s[0].click(); });
    await bekle(800);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button, a")).find(b => b.innerText?.toLowerCase().includes("ayrıntılar"));
      if (b) b.click();
    });
    await bekle(2000);
    const bilgiler = await page.evaluate(() => {
      const metin = document.body.innerText;
      const satirlar = metin.split("\n").map(s => s.trim()).filter(s => s);
      let adSoyad = "";
      for (let i = 0; i < satirlar.length; i++) {
        if (satirlar[i].toLowerCase().includes("alıcı adı soyadı") || satirlar[i].toLowerCase().includes("alıcı adı")) {
          adSoyad = satirlar[i + 1] || ""; break;
        }
      }
      let telefon = "";
      const gsmMatch = metin.match(/Gsm[:\s]+(5\d{9})/i);
      if (gsmMatch) { telefon = "0" + gsmMatch[1]; }
      else { const t = (metin.match(/0?5\d{9}/g) || []).find(t => t.replace(/^0/,"").startsWith("5")); if (t) telefon = t.startsWith("0") ? t : "0"+t; }
      return { adSoyad, telefon };
    });
    await browser.close();
    return bilgiler;
  } catch (e) {
    if (browser) await browser.close().catch(()=>{});
    throw e;
  }
}

app.post("/sorgula", async (req, res) => {
  const { gonderiNo } = req.body;
  if (!gonderiNo) return res.json({ hata: "Gonderi no eksik" });
  try {
    const bilgi = await gonderiGetir(gonderiNo.toUpperCase());
    if (!bilgi.adSoyad && !bilgi.telefon) return res.json({ hata: "Bilgi bulunamadi" });
    res.json(bilgi);
  } catch (e) {
    console.error("Hata:", e.message);
    res.json({ hata: "Sorgu basarisiz: " + e.message });
  }
});

function bekle(ms) { return new Promise(r => setTimeout(r, ms)); }

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Sunucu calisiyor! Port: ${PORT}`));
