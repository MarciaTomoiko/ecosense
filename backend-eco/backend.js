import express from "express";
import mqtt from "mqtt";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Pool } = pkg;

// Carrega variáveis do .env obs caso crie o arquivo .env no mesmo diretório que está o back

dotenv.config({
  path: path.resolve(process.cwd(), "backend-eco/.env"),
});

const app = express();
app.use(cors());
app.use(express.json());

app.post("/register", async (req, res) => {
  try {
    const { nome, email, senha } = req.body;

    const hashedPassword = await bcrypt.hash(senha, 10);

    await pool.query(
      "INSERT INTO usuarios (nome, email, senha) VALUES ($1, $2, $3)",
      [nome, email, hashedPassword]
    );

    res.json({ message: "Usuário registrado com sucesso!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao registrar usuário." });
  }
});

//  Login
app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    const user = result.rows[0];
    const senhaCorreta = await bcrypt.compare(senha, user.senha);

    if (!senhaCorreta) {
      return res.status(401).json({ error: "Senha incorreta" });
    }

    res.json({ message: "Login realizado com sucesso!", usuario: user.nome });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao fazer login." });
  }
});

// Variáveis do .env que serão lidas no caso são HIVEMQ e banco de dados.
const PORT = process.env.PORT || 3000;
const HIVEMQ_URL = process.env.HIVEMQ_URL;
const HIVEMQ_USER = process.env.HIVEMQ_USER;
const HIVEMQ_PASS = process.env.HIVEMQ_PASS;
const TOPIC = process.env.TOPIC || "esp32/sensores/cacambas";

// Servir diretório absoleto
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir o front-end
app.use(express.static(path.join(__dirname, "../")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../monitoramento-eco.html"));
});

//  Conexão com PostgreSQL
const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT,
});

//  Conexão com HiveMQ Cloud
const mqttClient = mqtt.connect(`mqtts://${HIVEMQ_URL}:8883`, {
  username: HIVEMQ_USER,
  password: HIVEMQ_PASS,
});

let ultimoDado = { id: "Sem dados ainda", nivelLixo: 0 };

mqttClient.on("connect", () => {
  console.log(" Conectado ao HiveMQ Cloud");

  mqttClient.subscribe(TOPIC, (err) => {
    if (!err) console.log(` Inscrito no tópico ${TOPIC}`);
    else console.error("❌ Erro ao se inscrever no tópico:", err);
  });
});

//  Recebe mensagens do ESP32 via MQTT
mqttClient.on("message", async (topic, message) => {
  try {
    const texto = message.toString();
    let data;

    // Aceita tanto formato JSON quanto chave simples
    if (texto.startsWith("{")) {
      data = JSON.parse(texto);
    } else {
      // Exemplo: CCBLX0001:5
      const [id, nivel] = texto.split(":");
      data = { id, nivelLixo: Number(nivel) };
    }

    // Atualiza último dado
    ultimoDado = data;
    console.log("📥 Atualizado:", ultimoDado);

    //  Salva no PostgreSQL
    await pool.query(
      "INSERT INTO dados_lixo (sensor_id, nivel_lixo) VALUES ($1, $2)",
      [data.id, data.nivelLixo]
    );
    console.log(" Dado salvo no banco!");
  } catch (error) {
    console.error(" Erro ao interpretar mensagem MQTT:", error);
  }
});

//  Endpoint para o front buscar último dado
app.get("/receber", (req, res) => {
  res.json(ultimoDado);
});

//  Novo endpoint: histórico de dados
app.get("/historico", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT sensor_id, nivel_lixo, data_hora FROM dados_lixo ORDER BY data_hora DESC LIMIT 50"
    );
    res.json(rows);
  } catch (err) {
    console.error(" Erro ao buscar histórico:", err);
    res.status(500).json({ error: "Erro ao buscar histórico" });
  }
});

//  Inicia o servidor
app.listen(PORT, () => {
  console.log(` Servidor rodando em http://localhost:${PORT}`);
});
