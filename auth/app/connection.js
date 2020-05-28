const mongoose = require('mongoose');

mongoose.connect(process.env.DB_URL, { useNewUrlParser: true });
mongoose.set('useCreateIndex', true);

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'Connection Error : '));

db.once('open', () => {
  console.log('Connection ok!');
});

module.exports = mongoose;
