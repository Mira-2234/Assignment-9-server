require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const run = async () => {

  try {

    await client.connect();

    const db = client.db('PawHome');

    const petsCollection = db.collection('pets');

    // GET all pets
    app.get('/pets', async (req, res) => {

      const cursor = petsCollection.find();

      const result = await cursor.toArray();

      res.send(result);
    });

    await client.db('admin').command({ ping: 1 });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  }
  finally {

  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send("Pet server is running!");
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
})