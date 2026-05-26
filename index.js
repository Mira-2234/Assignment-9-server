require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// ── Middleware ──
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-vercel-app.vercel.app'],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// ── MongoDB ──
const uri = "mongodb+srv://PawHome:wbQnrThgZ6ElsdsD@cluster0.7v4wvhy.mongodb.net/PawHome?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
    serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  family: 4,
});

// ── JWT Middleware ──
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Unauthorized' });
    req.user = decoded;
    next();
  });
};

const run = async () => {
  try {
    await client.connect();
    const db = client.db('PawHome');
    const petsCollection     = db.collection('pets');
    const requestsCollection = db.collection('requests');
    const usersCollection    = db.collection('users');

    console.log("✅ Connected to MongoDB!");

    // ══════════════════════════════════════
    //  AUTH ROUTES
    // ══════════════════════════════════════

    // Generate JWT token
    app.post('/auth/token', (req, res) => {
      const { email, name } = req.body;
      const token = jwt.sign({ email, name }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }).json({ success: true });
    });

    // Clear token (logout)
    app.post('/auth/logout', (req, res) => {
      res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      }).json({ success: true });
    });

    // Register user
    app.post('/register', async (req, res) => {
      try {
        const { name, email, photoURL } = req.body;
        const exists = await usersCollection.findOne({ email });
        if (!exists) {
          await usersCollection.insertOne({ name, email, photoURL, createdAt: new Date() });
        }
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // ══════════════════════════════════════
    //  PETS ROUTES
    // ══════════════════════════════════════

    // GET all pets (public) with search & filter
    app.get('/pets', async (req, res) => {
      try {
        const { search, species, sort } = req.query;
        const query = {};

        if (search) {
          query.$or = [
            { petName: { $regex: search, $options: 'i' } },
            { name:    { $regex: search, $options: 'i' } },
            { breed:   { $regex: search, $options: 'i' } },
          ];
        }

        if (species) {
          query.species = { $in: species.split(',') };
        }

        const sortMap = {
          fee_asc:  { adoptionFee: 1 },
          fee_desc: { adoptionFee: -1 },
          age_asc:  { age: 1 },
          age_desc: { age: -1 },
        };

        const pets = await petsCollection
          .find(query)
          .sort(sortMap[sort] || { createdAt: -1 })
          .toArray();

        res.json(pets);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // GET my listings (private)
    app.get('/pets/my-listings', verifyToken, async (req, res) => {
      try {
        const pets = await petsCollection
          .find({ ownerEmail: req.user.email })
          .sort({ createdAt: -1 })
          .toArray();
        res.json(pets);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // GET single pet (public)
    app.get('/pets/:id', async (req, res) => {
      try {
        const { id } = req.params;
        let pet = null;
        if (ObjectId.isValid(id) && id.length === 24) {
          pet = await petsCollection.findOne({ _id: new ObjectId(id) });
        } else {
          pet = await petsCollection.findOne({ _id: id });
        }
        if (!pet) return res.status(404).json({ message: 'Pet not found' });
        res.json(pet);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // POST add pet (private)
    app.post('/pets', verifyToken, async (req, res) => {
      try {
        const pet = {
          ...req.body,
          ownerEmail: req.user.email,
          ownerName:  req.user.name,
          status:     'available',
          createdAt:  new Date(),
        };
        const result = await petsCollection.insertOne(pet);
        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // PUT update pet (private)
    app.put('/pets/:id', verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const filter = ObjectId.isValid(id) && id.length === 24
          ? { _id: new ObjectId(id) }
          : { _id: id };
        const result = await petsCollection.findOneAndUpdate(
          filter,
          { $set: req.body },
          { returnDocument: 'after' }
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // DELETE pet (private)
    app.delete('/pets/:id', verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const filter = ObjectId.isValid(id) && id.length === 24
          ? { _id: new ObjectId(id) }
          : { _id: id };
        await petsCollection.deleteOne(filter);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // ══════════════════════════════════════
    //  REQUESTS ROUTES
    // ══════════════════════════════════════

    // GET requests (private)
    app.get('/requests', verifyToken, async (req, res) => {
      try {
        const { ownerEmail } = req.query;
        const query = ownerEmail
          ? { ownerEmail }
          : { requesterEmail: req.user.email };
        const requests = await requestsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.json(requests);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // POST submit request (private)
    app.post('/requests', verifyToken, async (req, res) => {
      try {
        const { petId, pickupDate, message } = req.body;

        // find pet
        let pet = null;
        if (ObjectId.isValid(petId) && petId.length === 24) {
          pet = await petsCollection.findOne({ _id: new ObjectId(petId) });
        } else {
          pet = await petsCollection.findOne({ _id: petId });
        }

        if (!pet) return res.status(404).json({ message: 'Pet not found' });
        if (pet.ownerEmail === req.user.email) {
          return res.status(400).json({ message: 'You cannot adopt your own pet' });
        }
        if (pet.status === 'adopted') {
          return res.status(400).json({ message: 'This pet is already adopted' });
        }

        // duplicate check
        const existing = await requestsCollection.findOne({
          petId:          String(petId),
          requesterEmail: req.user.email,
          status:         { $in: ['pending', 'approved'] },
        });
        if (existing) {
          return res.status(400).json({ message: 'You already have an active request for this pet' });
        }

        const request = await requestsCollection.insertOne({
          petId:          String(petId),
          petName:        pet.petName || pet.name || '',
          petImage:       pet.imageUrl || pet.image || '',
          requesterName:  req.user.name || '',
          requesterEmail: req.user.email,
          ownerEmail:     pet.ownerEmail || '',
          pickupDate,
          message:        message || '',
          status:         'pending',
          createdAt:      new Date(),
        });

        res.status(201).json(request);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // PUT approve/reject request (private)
    app.put('/requests/:id', verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const request = await requestsCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { status } },
          { returnDocument: 'after' }
        );

        // approved হলে pet status adopted করো
        if (status === 'approved') {
          const petFilter = ObjectId.isValid(request.petId) && request.petId.length === 24
            ? { _id: new ObjectId(request.petId) }
            : { _id: request.petId };

          await petsCollection.updateOne(petFilter, { $set: { status: 'adopted' } });

          // বাকি pending requests reject করো
          await requestsCollection.updateMany(
            { petId: request.petId, _id: { $ne: new ObjectId(id) }, status: 'pending' },
            { $set: { status: 'rejected' } }
          );
        }

        res.json(request);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // DELETE cancel request (private)
    app.delete('/requests/:id', verifyToken, async (req, res) => {
      try {
        await requestsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // ── Ping ──
    await client.db('admin').command({ ping: 1 });

  } catch (err) {
    console.error(err);
  }
};

run();

app.get('/', (req, res) => res.send('🐾 PawHome server is running!'));
app.listen(port, () => console.log(`Server running on port ${port}`));