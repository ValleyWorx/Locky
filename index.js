require('dotenv').config()
var config = {
    apiKey: process.env.API_KEY
    authDomain: process.env.AUTH_DOMAIN
    databaseURL: "https://locky-project.firebaseio.com",
    projectId: "locky-project",
    storageBucket: "locky-project.appspot.com",
    messagingSenderId: "985106511203"
  };
  firebase.initializeApp(config);