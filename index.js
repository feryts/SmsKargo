const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE = "153759";
const API_BASE = "https://api.kolaygelsin.com/api/request";

let token = null;
let tokenZamani = null;

async function tokenAl() {
  try {
    const formData = new URLSearchParams();
    formData.append("userName", KOLAYGELSIN_KULLANICI);
    formData.append("password", KOLAYGELSIN_SIFRE);
    formData.append("grant_type", "password");
    formData.append("channel", "1");
    formData.append("CustomerType", "null");
    formData.append("CaptchaToken", "");
    formData.append("VerificationCode", "");
    const res = await axios.post(API_BASE + "/login", formData.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", "origin": "https://kurumsal.kolaygelsin.com" }
    });
    const t = res.data.access_token || res.data.token || res.data.Token;
    if (t) { token = t; tokenZamani = Date.now(); console.log("Token alindi!"); return true; }
    return false;
  } catch (e) { console.error("Token hatasi:", e.message); return false; }
}

async function tokenKontrol() {
  if (!token || !tokenZamani || (Date.now() - tokenZamani) > 23 * 60 * 60 * 1000) await tokenAl();
}

async function gonderiGetir(gonderiNo) {
  await tokenKontrol();
  if (!token) throw new Error("Token alinamadi");
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "bearer " + token,
    "origin": "https://kurumsal.kolaygelsin.com",
  };

  let shipment = null;
  if (gonderiNo.length > 15) {
    const r = await axios.post(API_BASE + "/GetShipments", { CustomerBarcode: gonderiNo, PageSize: 10, PageNumber: 1 }, { headers });
    shipment = r.data?.Payload?.ResultList?.[0];
  } else {
    const r = await axios.post(API_BASE + "/GetShipments", { ShipmentId: gonderiNo, PageSize: 10, PageNumber: 1 }, { headers });
    shipment = r.data?.Payload?.ResultList?.[0];
    if (!shipment) {
      const r2 = await axios.post(API_BASE + "/GetShipments", { CustomerBarcode: gonderiNo, PageSize: 10, PageNumber: 1 }, { headers });
      shipment = r2.data?.Payload?.ResultList?.[0];
    }
  }

  if (!shipment) throw new Error("Gonderi bulunamadi");

  const adSoyad = shipment.RecipientName || "";
  const shipmentId = shipment.ShipmentId;

  const r3 = await axios.post(API_BASE + "/GetShipmentById", { ShipmentId: shipmentId }, { headers });
  const detay = r3.data?.Payload;

  const gsm = detay?.Recipient?.Gsm || "";
  let telefon = "";
  if (gsm.startsWith("5") && gsm.length === 10) telefon = "0" + gsm;
  else if (gsm.startsWith("05") && gsm.length === 11) telefon = gsm;

  const adresText = detay?.Recipient?.Address?.AddressText || "";
  const ilce = detay?.Recipient?.Address?.TownName || "";
  const il = detay?.Recipient?.Address?.CityName || "";
  const adres = [adresText, ilce, il].filter(Boolean).join(" / ");

  return { adSoyad, telefon, adres };
}

const cache = {};

setInterval(() => {
  const simdi = Date.now();
  for (const key in cache) {
    if (simdi - cache[key].zaman > 3600000) delete cache[key];
  }
  console.log("Cache temizlendi");
}, 3600000);

app.get("/ping", (req, res) => res.send("ok"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.post("/sorgula", async (req, res) => {
  const gonderiNo = req.body?.gonderiNo;
  if (!gonderiNo) return res.json({ hata: "Gonderi no eksik" });
  const key = gonderiNo.toUpperCase();
  if (cache[key] && (Date.now() - cache[key].zaman) < 3600000) {
    console.log("Cache'den geldi:", key);
    return res.json(cache[key].data);
  }
  try {
    const bilgi = await gonderiGetir(key);
    if (!bilgi.adSoyad && !bilgi.telefon) return res.json({ hata: "Bilgi bulunamadi" });
    cache[key] = { data: bilgi, zaman: Date.now() };
    res.json(bilgi);
  } catch (e) {
    console.error("Hata:", e.message);
    res.json({ hata: "Sorgu basarisiz: " + e.message });
  }
});

tokenAl();
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Sunucu calisiyor! Port: " + PORT));
