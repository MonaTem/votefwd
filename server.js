 //server.js
'use strict'

var express = require('express');
var cors = require('cors');
var path = require('path');
var bodyParser = require('body-parser');
var pdf = require('html-pdf');
var Storage = require('@google-cloud/storage');
var Handlebars = require('handlebars');
var Hashids = require('hashids');
var uuidv4 = require('uuid/v4');

var rateLimits = require('./ratelimits')
var voterService = require('./voterService');
var db = require('./src/db');
var fs = require('fs');
var os = require('os');

var app = express();
var router = express.Router();
var port = process.env.REACT_APP_API_PORT || 3001;
var corsOption = {
  origin: true,
  moethods: 'GET, HEAD, PUT, PATCH, POST, DELETE',
  credentials: true,
}

var hashids = new Hashids(process.env.REACT_APP_HASHID_SALT, 6,
  process.env.REACT_APP_HASHID_DICTIONARY);

//app.use(express.static(path.join(__dirname, 'build')));
app.use(cors(corsOption));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

router.get('/', function(req, res) {
  res.json('API initialized.');
});

router.route('/voters')
  .get(function(req, res) {
    voterService.getUsersAdoptedVoters(req.query.user_id,
      function(result) {
        res.json(result)
      });
  });

router.route('/voter/random')
  .get(function(req, res) {
    voterService.getRandomVoter(
      function(result) {
        res.json(result)
      });
  });

router.route('/voter/adopt')
  .put(function(req, res) {
    voterService.adoptVoter(req.body.id, req.body.adopterId, function(result) {
      res.json(result);
    });
  });

router.route('/voter/confirm-send')
  .put(function(req, res) {
    voterService.confirmSend(req.body.id, function(result) {
      res.json(result);
    });
  });

router.route('/voter/pledge')
  .post(rateLimits.makePledgeRateLimit, function(req, res) {
    voterService.makePledge(req.body.code, function(result) {
      res.json(result);
    });
  });

function timeStamp() {
  var newDate = new Date();
  var DateString;
  DateString = newDate.getFullYear()
             + ('0' + (newDate.getMonth()+1)).slice(-2)
             + ('0' + newDate.getDate()).slice(-2);
  return DateString;
}

function getSignedUrlForGCPFile(gcpFileObject) {
  /*
  Takes a gcp file object and applies a static config to create a signed url.
  Inputs:
    gcpFileObject - an instance of  https://cloud.google.com/nodejs/docs/reference/storage/1.6.x/File
  Returns:
    A signed url https://cloud.google.com/nodejs/docs/reference/storage/1.6.x/File#getSignedUrl
    or an error
  */

  // Set a date two days in a future
  var expDate = new Date();
  expDate.setDate(expDate.getDate() + 2);

  var config = {
      action: 'read',
      expires: expDate,
  }

  gcpFileObject.getSignedUrl(config, function(err, url) {
    if (err) {
      console.error(err);
      return;
    };

    let pleaLetterUrl = 'http://storage.googleapis.com/' + url;
    return pleaLetterUrl;
  });
}

router.route('/voter/:voter_id/letter')
  .get(function(req, res) {
    var timestamp = timeStamp();
    var voterId = req.params.voter_id;
    var hashId = hashids.encode(voterId);
    var uuid = uuidv4();
    var pledgeUrl = 'http://localhost:3000/pledge';
    var template = fs.readFileSync('./letter.html', 'utf8');
    var uncompiledTemplate = Handlebars.compile(template);
    var context = {
      voterId: voterId,
      timestamp: timestamp,
      hashId: hashId,
      pledgeUrl: pledgeUrl
      };
    var html = uncompiledTemplate(context);
    var options = { format: 'Letter' };
    const tmpdir = os.tmpdir();
    const remotefileName = timestamp + '-' + uuid + '-letter.pdf'
    const downloadFileName = timestamp + '-VoteForward-letter.pdf' //TODO: add voter name
    const filePath = tmpdir + '/' + remotefileName;
    const bucketName = 'voteforward';
    const storage = new Storage({
      keyFilename: './googleappcreds.json'
    })
    const uploadOptions =
                {
                    gzip: true,
                    contentType: 'application/pdf',
                    contentDisposition: 'attachment',
                    metadata: {
                        contentType: 'application/pdf',
                        contentDisposition: `attachment; filename='${downloadFileName}`,
                    },
                    headers: {
                        contentType: 'application/pdf',
                        contentDisposition: 'attachment',
                    }
                };
    pdf.create(html).toFile(filePath, function(err, response){
      if(err) {
        console.error('ERROR:', err)
      }
      else {
        storage
          .bucket(bucketName)
          .upload(response.filename, uploadOptions)
          .then(() => {
            let pleaLetterUrl = 'http://storage.googleapis.com/' + bucketName + '/' + remotefileName;
            res.send(pleaLetterUrl);
            db('voters')
              .where('id', voterId)
              .update('plea_letter_url', pleaLetterUrl)
              .update('hashid', hashId)
              .catch(err=> {
                console.error('ERROR: ', err);
              });
          })
          .catch(err => {
            console.error('ERROR: ', err);
          });
      }
    });
  });

router.route('/user')
  .post(function(req, res) {
    if (req.body.auth0_id) {
      db('users').where('auth0_id', req.body.auth0_id)
        .then(function(result) {
          if (result.length != 0)
          {
            res.status(200).send('User already exists.');
          }
          else
          {
            db('users').insert({auth0_id: req.body.auth0_id})
              .then(function(result) {
              res.status(201).send(result);
            });
          }
        });
    }
    else {
      res.status(500).send('No auth0_id provided.');
    }
  });

//Use router configuration at /api
app.use('/api', router);

//start server and listen for requests
app.listen(port, function() {
  console.log(`api running on port ${port}`);
});
