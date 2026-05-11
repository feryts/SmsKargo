const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const API_BASE              = "https://api.kolaygelsin.com/api/request";

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

    const res = await axios.post(`${API_BASE}/login`, formData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "origin": "https://kurumsal.kolaygelsin.com",
        "referer": "https://kurumsal.kolaygelsin.com/",
      }
    });

    console.log("Login yaniti:", JSON.stringify(res.data).substring(0, 300));

    const t = res.data?.access_token || res.data?.token || res.data?.Token || res.data?.Payload?.Token;
    if (t) {
      token = t;
      tokenZamani = Date.now();
      console.log("Token alindi!");
      return true;
    }
    return false;
  } catch (e) {
    console.error("Token hatasi:", e.response?.data || e.message);
    return false;
  }
}

async function tokenKontrol() {
  if (!token || !tokenZamani || (Date.now() - tokenZamani) > 23 * 60 * 60 * 1000) {
    await tokenAl();
  }
}

async function gonderiGetir(gonderiNo) {
  await tokenKontrol();
  if (!token) throw new Error("Token alinamadi");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `bearer ${token}`,
    "access-control-allow-methods": "GET, POST, PUT, DELETE",
    "access-control-allow-origin": "*",
    "origin": "https://kurumsal.kolaygelsin.com",
    "referer": "https://kurumsal.kolaygelsin.com/",
  };

  // Adım 1: GetShipments
  const shipmentsRes = await axios.post(`${API_BASE}/GetShipments`, {
    ShipmentId: gonderiNo,
    PageSize: 10,
    PageNumber: 1
  }, { headers });

  const shipment = shipmentsRes.data?.Payload?.ResultList?.[0];
  if (!shipment) throw new Error("Gonderi bulunamadi");

  const adSoyad = shipment.RecipientName || "";
  const shipmentId = shipment.ShipmentId;

  console.log("Ad Soyad:", adSoyad, "ShipmentId:", shipmentId);

  // Adım 2: GetShipmentById — telefon al
  const detayRes = await axios.post(`${API_BASE}/GetShipmentById`, {
    ShipmentId: shipmentId
  }, { headers });

  const detayStr = JSON.stringify(detayRes.data?.Payload || "");
  console.log("Detay:", detayStr.substring(0, 300));

  // Telefon numarasını bul
  let telefon = "";
  const gsmMatch = detayStr.match(/"(5\d{9})"/);
  if (gsmMatch) {
    telefon = "0" + gsmMatch[1];
  } else {
    const telMatch = detayStr.match(/0(5\d{9})/);
    if (telMatch) telefon = "0" + telMatch[1];
  }

  return { adSoyad, telefon };
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

tokenAl();

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Sunucu calisiyor! Port: ${PORT}`));
