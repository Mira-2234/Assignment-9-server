require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcryptjs');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app  = express();
const port = process.env.PORT || 5000;

//Middleware 
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://your-vercel-app.vercel.app',
    ],
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// MongoDB
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version:           ServerApiVersion.v1,
        strict:            true,
        deprecationErrors: true,
    },
});

// JWT Middleware
const verifyToken = (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ message: 'Unauthorized' });
        req.user = decoded;
        next();
    });
};

// Cookie Helper
const setCookie = (res, token) => {
    res.cookie('token', token, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        maxAge:   7 * 24 * 60 * 60 * 1000,
    });
};

const run = async () => {
    try {
        await client.connect();
        const db                 = client.db('PawHome');
        const petsCollection     = db.collection('pets');
        const requestsCollection = db.collection('requests');
        const usersCollection    = db.collection('users');

        console.log("✅ Connected to MongoDB!");

        

        // Register
        app.post('/register', async (req, res) => {
            try {
                const { name, email, photoURL, password } = req.body;

                const exists = await usersCollection.findOne({ email });
                if (exists) {
                    return res.status(400).json({ message: 'Email already in use' });
                }

                const hashed = await bcrypt.hash(password, 10);

                await usersCollection.insertOne({
                    name,
                    email,
                    photoURL: photoURL || '',
                    password: hashed,
                    createdAt: new Date(),
                });

                const token = jwt.sign(
                    { email, name },
                    process.env.JWT_SECRET,
                    { expiresIn: '7d' }
                );

                setCookie(res, token);
                res.status(201).json({
                    success: true,
                    user: { name, email, photoURL: photoURL || '' },
                });

            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // Login
        app.post('/auth/login', async (req, res) => {
            try {
                const { email, password } = req.body;

                const user = await usersCollection.findOne({ email });
                if (!user) {
                    return res.status(400).json({ message: 'No user found with this email' });
                }

                const isValid = await bcrypt.compare(password, user.password);
                if (!isValid) {
                    return res.status(400).json({ message: 'Invalid password' });
                }

                const token = jwt.sign(
                    { email: user.email, name: user.name },
                    process.env.JWT_SECRET,
                    { expiresIn: '7d' }
                );

                setCookie(res, token);
                res.json({
                    success: true,
                    user: {
                        name:     user.name,
                        email:    user.email,
                        photoURL: user.photoURL || '',
                    },
                });

            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // Google login - JWT issue
        app.post('/auth/token', async (req, res) => {
            try {
                const { email, name, photoURL } = req.body;
                if (!email) return res.status(400).json({ message: 'Email required' });

        
                const exists = await usersCollection.findOne({ email });
                if (!exists) {
                    await usersCollection.insertOne({
                        name:      name || '',
                        email,
                        photoURL:  photoURL || '',
                        password:  '',
                        createdAt: new Date(),
                    });
                }

                const token = jwt.sign(
                    { email, name: name || '' },
                    process.env.JWT_SECRET,
                    { expiresIn: '7d' }
                );

                setCookie(res, token);
                res.json({ success: true });

            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // Logout
        app.post('/auth/logout', (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure:   process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            }).json({ success: true });
        });

  

        // GET all pets — public (search + filter + sort)
        app.get('/pets', async (req, res) => {
            try {
                const { search, species, sort } = req.query;

                const query = {
                    $or: [
                        { status: 'available' },
                        { status: { $exists: false } },
                    ],
                };

                if (search) {
                    query.$and = [{
                        $or: [
                            { name:    { $regex: search, $options: 'i' } },
                            { petName: { $regex: search, $options: 'i' } },
                            { breed:   { $regex: search, $options: 'i' } },
                            { location:{ $regex: search, $options: 'i' } },
                        ],
                    }];
                }

                if (species) {
                    const arr = { species: { $in: species.split(',') } };
                    query.$and ? query.$and.push(arr) : (query.$and = [arr]);
                }

                const sortMap = {
                    fee_asc:  { adoptionFee:  1 },
                    fee_desc: { adoptionFee: -1 },
                    age_asc:  { age:  1 },
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

        // GET featured pets — public
        app.get('/pets/featured', async (req, res) => {
            try {
                const pets = await petsCollection
                    .find({ $or: [{ status: 'available' }, { status: { $exists: false } }] })
                    .sort({ createdAt: -1 })
                    .limit(6)
                    .toArray();
                res.json(pets);
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // GET my listings — private
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

        // GET single pet — public
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

        // POST add pet — private (owner)
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
                res.status(201).json({ ...pet, _id: result.insertedId });
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // PUT update pet — private (owner only)
        app.put('/pets/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params;

                const filter = ObjectId.isValid(id) && id.length === 24
                    ? { _id: new ObjectId(id) }
                    : { _id: id };

                const pet = await petsCollection.findOne(filter);
                if (!pet) return res.status(404).json({ message: 'Pet not found' });
                if (pet.ownerEmail !== req.user.email) {
                    return res.status(403).json({ message: 'Forbidden' });
                }

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

        // Delete pet — private (owner)
        app.delete('/pets/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params;

                const filter = ObjectId.isValid(id) && id.length === 24
                    ? { _id: new ObjectId(id) }
                    : { _id: id };

                const pet = await petsCollection.findOne(filter);
                if (!pet) return res.status(404).json({ message: 'Pet not found' });
                if (pet.ownerEmail !== req.user.email) {
                    return res.status(403).json({ message: 'Forbidden' });
                }

                await petsCollection.deleteOne(filter);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

  
        // GET my requests — private
        app.get('/requests', verifyToken, async (req, res) => {
            try {
                const requests = await requestsCollection
                    .find({ requesterEmail: req.user.email })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.json(requests);
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // GET requests for a pet — private (owner)
        app.get('/requests/pet/:petId', verifyToken, async (req, res) => {
            try {
                const { petId } = req.params;

                const filter = ObjectId.isValid(petId) && petId.length === 24
                    ? { _id: new ObjectId(petId) }
                    : { _id: petId };

                const pet = await petsCollection.findOne(filter);
                if (!pet) return res.status(404).json({ message: 'Pet not found' });
                if (pet.ownerEmail !== req.user.email) {
                    return res.status(403).json({ message: 'Forbidden' });
                }

                const requests = await requestsCollection
                    .find({ petId: String(petId) })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.json(requests);
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // POST submit request — private
        app.post('/requests', verifyToken, async (req, res) => {
            try {
                const { petId, pickupDate, message } = req.body;

                const filter = ObjectId.isValid(petId) && petId.length === 24
                    ? { _id: new ObjectId(petId) }
                    : { _id: petId };

                const pet = await petsCollection.findOne(filter);
                if (!pet) return res.status(404).json({ message: 'Pet not found' });

                if (pet.ownerEmail === req.user.email) {
                    return res.status(400).json({ message: 'You cannot adopt your own pet' });
                }
                if (pet.status === 'adopted') {
                    return res.status(400).json({ message: 'This pet is already adopted' });
                }

                const existing = await requestsCollection.findOne({
                    petId:          String(petId),
                    requesterEmail: req.user.email,
                    status:         { $in: ['pending', 'approved'] },
                });
                if (existing) {
                    return res.status(400).json({ message: 'You already have an active request' });
                }

                const request = {
                    petId:          String(petId),
                    petName:        pet.name || pet.petName || '',
                    petImage:       pet.image || pet.imageUrl || '',
                    requesterName:  req.user.name || '',
                    requesterEmail: req.user.email,
                    ownerEmail:     pet.ownerEmail || '',
                    pickupDate,
                    message:        message || '',
                    status:         'pending',
                    createdAt:      new Date(),
                };

                const result = await requestsCollection.insertOne(request);
                res.status(201).json({ ...request, _id: result.insertedId });
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // PATCH approve/reject — private (owner)
        app.patch('/requests/:id', verifyToken, async (req, res) => {
            try {
                const { id }     = req.params;
                const { status } = req.body;

                const request = await requestsCollection.findOne({ _id: new ObjectId(id) });
                if (!request) return res.status(404).json({ message: 'Request not found' });
                if (request.ownerEmail !== req.user.email) {
                    return res.status(403).json({ message: 'Forbidden' });
                }

                if (status === 'approved') {
                    const alreadyApproved = await requestsCollection.findOne({
                        petId:  request.petId,
                        status: 'approved',
                        _id:    { $ne: new ObjectId(id) },
                    });
                    if (alreadyApproved) {
                        return res.status(400).json({ message: 'Another request already approved' });
                    }

                    //  adopted mark
                    const petFilter = ObjectId.isValid(request.petId) && request.petId.length === 24
                        ? { _id: new ObjectId(request.petId) }
                        : { _id: request.petId };

                    await petsCollection.updateOne(petFilter, { $set: { status: 'adopted' } });

                    // requests reject
                    await requestsCollection.updateMany(
                        { petId: request.petId, _id: { $ne: new ObjectId(id) }, status: 'pending' },
                        { $set: { status: 'rejected' } }
                    );
                }

                await requestsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status } }
                );

                res.json({ success: true, status });
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // DELETE cancel request — private
        app.delete('/requests/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params;

                const request = await requestsCollection.findOne({ _id: new ObjectId(id) });
                if (!request) return res.status(404).json({ message: 'Request not found' });

                const isRequester = request.requesterEmail === req.user.email;
                const isOwner     = request.ownerEmail     === req.user.email;

                if (!isRequester && !isOwner) {
                    return res.status(403).json({ message: 'Forbidden' });
                }
                if (request.status === 'approved') {
                    return res.status(400).json({ message: 'Cannot cancel an approved request' });
                }

                await requestsCollection.deleteOne({ _id: new ObjectId(id) });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        await client.db('admin').command({ ping: 1 });

    } catch (err) {
        console.error(err);
    }
};

run();

app.get('/', (req, res) => res.send('🐾 PawHome server is running!'));
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));