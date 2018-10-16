 //server.js
'use strict'

var express = require('express');
var cors = require('cors');
var path = require('path');
var bodyParser = require('body-parser');
var pdf = require('html-pdf');
var Handlebars = require('handlebars');
var Hashids = require('hashids');
var uuidv4 = require('uuid/v4');
var request = require('request');
var compileSass = require('express-compile-sass');

var rateLimits = require('./rateLimits')
var userService = require('./userService');
var voterService = require('./voterService');
var letterService = require('./letterService');
var slackService = require('./slackService');

var db = require('./db');
var fs = require('fs');
var os = require('os');

var app = express();
var jwt = require('express-jwt');
var jwtAuthz = require('express-jwt-authz');
var jwksRsa = require('jwks-rsa');
var router = express.Router();
var port = process.env.REACT_APP_API_PORT || 3001;
var corsOption = {
  origin: true,
  methods: 'GET, HEAD, PUT, PATCH, POST, DELETE',
  credentials: true,
}

var hashids = new Hashids(process.env.REACT_APP_HASHID_SALT, 6,
  process.env.REACT_APP_HASHID_DICTIONARY);

app.use(express.static(path.resolve(__dirname, '..', 'build')));
app.use(express.static(path.resolve(__dirname, '..', 'public')));

app.use(cors(corsOption));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const checkJwt = jwt({
  // Dynamically provide a signing key based on the kid in the header and the signing keys provided by the JWKS endpoint.
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: 'https://votefwd.auth0.com/.well-known/jwks.json'
  }),

  // Validate the audience and the issuer.
  audience: 'https://votefwd.org/api',
  issuer: 'https://votefwd.auth0.com/',
  algorithms: ['RS256']
});

router.get('/', function(req, res) {
  res.json('API initialized.');
});

router.route('/bundles')
.get(checkJwt, function(req, res) {
  db('bundles')
    .where('adopter_user_id', req.query.user_id).orderBy('district_id', 'asc').orderBy('adopted_at', 'asc')
    .then(function(result) {
      res.json(result)
    })
    .catch(err => {
      console.error(err);
      res.status(500).end();
      return;
    });
});

router.route('/voters')
.get(checkJwt, function(req, res) {
  voterService.getUsersAdoptedVoters(req.query.user_id,
    function(result) {
      res.json(result)
    });
});

router.route('/voters/relinquish')
.get(checkJwt, function(req, res) {
  const { user_id, adopted_at, district_id } = req.query
  voterService.relinquishVoters(user_id, adopted_at, district_id,
    function(result) {
      res.json(result)
    });
});

router.route('/voter/adopt-random')
  .post(checkJwt, function(req, res) {
    voterService.adoptRandomVoter(req.body.adopterId, req.body.numVoters, req.body.districtId, function(error, voters) {
      if (error) {
        console.error(error);
        res.status(500).end();
        return;
      }
      let response = {};
      response.voters = voters;
      res.json(response);
    });
  });

/**
 * returns callback function for downloadLetterToVoter and downloadAllLetters
 */
function downloadFileCallback(res) {
  return (err, filepath, downloadFileName) => {
    if (err) {
      res.status(500).send('Error generating file');
      console.error('Error generating file for voter(s)');
      console.error(err);
      return;
    }
    res.header('Access-Control-Expose-Headers', "Filename");
    res.header('Content-Type', "application/pdf");
    res.header('Filename', downloadFileName);
    res.download(filepath, downloadFileName, function (err) {
        if (err) {
          console.log("Error downloading letter(s).");
          console.log(err);
        } else {
          console.log("Success downloading letter(s).");
        }
    });
  };
}
// Keep /downloadLetter route so that after deployment
//   people who don't refresh their browser won't get
//   errors.
router.route('/voters/downloadLetter')
  .get(checkJwt, function(req, res) {
    const params = { userId: req.user.sub, voterId: req.query.voter_id };
    voterService.getVoters(params)
    .then((voters) => {
      if (voters.length === 0) {
        res.status(500).send('No voters found');
      } else {
        voterService.downloadLetterToVoter(req.query.voter_id, downloadFileCallback(res));
      }
    });
  });

router.route('/voters/downloadAllLettersForUser')
  .get(checkJwt, checkAdmin, function(req, res) {
    voterService.downloadAllLetters(req.query.user_id, downloadFileCallback(res));
  });

/**
 * If the JWT contains a "voterId" value, then this is a letter to a single voter.
 * Otherwise it's a letter to all voters for that user.
 */
router.route('/letters/:letterJwt.pdf')
  .get(function(req, res) {
    voterService.downloadPdf(req.params.letterJwt, downloadFileCallback(res));
  });


/**
 * This route creates a secure url that can be used to download the pdf.  It
 * creates a one-minute-long JWT that gets included in the url
 * that contains either userId and voterId to download a single voter's pdf,
 * or just the userId to download all voters for that user.
 */
router.route('/voters/letterUrl')
  .get(checkJwt, function(req, res) {
    // include the userId from the JWT to make sure the user
    //  has access to that voter
    const params = { userId: req.user.sub };
    if (req.query.voter_id) {
      params.voterId = req.query.voter_id;
    }
    voterService.getVoters(params)
    .then((voters) => {
      if (voters.length === 0) {
        res.status(500).send('No voters found');
      } else {
        voterService.downloadLetterUrl(params)
          .then((url) => {
            res.json({ url });
          })
          .catch((err) => {
            res.status(500).send('error getting url');
          });
      }
    })
  });

router.route('/voter/confirm-prepped')
  .put(checkJwt, function(req, res) {
    voterService.confirmPrepped(req.body.id, function(result) {
      res.json(result);
    });
  });

router.route('/voter/undo-confirm-prepped')
  .put(checkJwt, function(req, res) {
    voterService.undoConfirmPrepped(req.body.id, function(result) {
      res.json(result);
    });
  });

router.route('/voter/confirm-sent')
  .put(checkJwt, function(req, res) {
    voterService.confirmSent(req.body.id, function(result) {
      res.json(result);
    });
  });

router.route('/voter/undo-confirm-sent')
  .put(checkJwt, function(req, res) {
    voterService.undoConfirmSent(req.body.id, function(result) {
      res.json(result);
    });
  });

router.route('/voter/pledge')
  .post(rateLimits.makePledgeRateLimit, function(req, res) {
    voterService.makePledge(req.body.code, function(result) {
      res.json(result);
    });
  });

router.route('/voter/info')
  .post((req, res) => {
    voterService.voterInfoFromHash(req.body.code)
    .then((voterInfo) => {
      res.json({
        urlElectionInfo: voterInfo.district.url_election_info,
        voterState: voterInfo.district.state,
        shouldRecordPledge: voterInfo.shouldRecordPledge
      });
    })
    .catch((err) => {
      if (err.name === 'NotFoundError') {
        res.status(400).send('hashid not found');
      }
    });
  });
router.route('/voter/signed-letter-url')
  .get(checkJwt, function(req, res) {
    letterService.getSignedUrl(req.query.url, function(result) {
      res.json(result);
    });
  });

router.route('/user/new')
  .post(checkJwt, function(req, res) {
    if (req.body.auth0_id) {
      db('users').where('auth0_id', req.body.auth0_id)
        .then(function(result) {
          if (result.length != 0) {
            if (result[0].email != req.body.email) {
              userService.updateEmail(req.body.auth0_id, req.body.email);
            }
            res.status(200).send('User already exists.');
          }
          else {
            db('users').insert({
              auth0_id: req.body.auth0_id,
              email: req.body.email
            })
              .then(function(result) {
              res.status(201).send(result);
            })
            .then(function() {
              slackService.publishToSlack('A new user signed up.');
            })
            .catch(err => {console.error(err)});
          }
        })
        .catch(err => {console.error(err)});
    }
  })

function verifyHumanity(req, callback) {
  const recaptchaResponse = req.body.recaptchaResponse;
    request.post('https://www.google.com/recaptcha/api/siteverify', {
      form: {
        secret: process.env.REACT_APP_RECAPTCHA_SECRET_KEY,
        response: recaptchaResponse,
        remoteip: req.connection.remoteAddress
      },
    }, (err, httpResponse, body)=>{
      if(err) {
        err => {console.error(err);}
      }
      else {
        const r = JSON.parse(body);
        if (r.success) {
          callback(true);
        } else {
          callback(false);
        }
      }
    });
}

router.route('/recaptcha')
  .post(checkJwt, function(req, res) {
    verifyHumanity(req, function(r) {
      if(r) {
        res.json(r);
      } else {
        res.status(400);
        res.send({
          error: 'Please verify that you\'re human'
        })
      }
    });
  });

router.route('/user')
  .get(checkJwt, function(req, res) {
    db('users')
      .where('auth0_id', req.query.auth0_id)
      .then(function(result) {
        res.json(result);
      })
      .catch(err => {console.error(err);})
  })
  .post(checkJwt, function(req, res) {
    let query = db('users')
      .where('auth0_id', req.body.auth0_id)
      .update('updated_at', db.fn.now())
    if (req.body.is_human_at) {
      query.update('is_human_at', db.fn.now())
      .then(res.status(201).send('Stored humanness timestamp.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.pledged_vote_at) {
      query.update('pledged_vote_at', db.fn.now())
      .then(res.status(201).send('Stored sender pledge to vote timestamp.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.full_name) {
      query.update('full_name', req.body.full_name)
      .then(res.status(201).send('Stored full name.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.is_resident_at) {
      query.update('is_resident_at', db.fn.now())
      .then(res.status(201).send('Stored legal status.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.zip) {
      query.update('zip', req.body.zip)
      .then(res.status(201).send('Stored ZIP code.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.current_district) {
      query.update('current_district', req.body.current_district)
      .then(res.status(201).send('Stored current district.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.accepted_code_at) {
      query.update('accepted_code_at', db.fn.now())
      .then(query.update('accepted_terms_at', db.fn.now()))
      .then(res.status(201).send('Stored code and terms agreement timestamps.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.twitter_profile_url) {
      query.update('twitter_profile_url', req.body.twitter_profile_url)
      .then(res.status(201).send('Stored Twitter profile link.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.facebook_profile_url) {
      query.update('facebook_profile_url', req.body.facebook_profile_url)
      .then(res.status(201).send('Stored Facebook profile link.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.linkedin_profile_url) {
      query.update('linkedin_profile_url', req.body.linkedin_profile_url)
      .then(res.status(201).send('Stored LinkedIn profile link.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
    if (req.body.why_write_letters) {
      query.update('why_write_letters', req.body.why_write_letters)
      .then(res.status(201).send('Updated reason for writing letters.'))
      .catch(err=> {console.error('ERROR: ', err)})
    }
  });

/**
 * Look up the details for a ZIP code.
 */
router.route('/lookup-zip-details')
  .get(function(req, res) {
    db('lu_zip')
      .where({ zip: req.query.zip })
      .then(function(result) {
        res.json(result);
      })
      .catch(err => {console.error(err);});
  });

/**
 * Find the closest target district to a given ZIP code.
 */
router.route('/lookup-zip')
  .get(checkJwt, function(req, res) {
    db('lu_zip')
      .where({ zip: req.query.zip })
      .then(function(result) {
        if (result.length === 0) {
          res.json(false);
        } else {
          const ziplat = result[0].lat;
          const ziplong = result[0].long;
          const table = 'districts_with_unclaimed_voters'
          const distanceString = `point(${ziplat}, ${ziplong}) <-> point(${table}.coordinates) as distance`;
          let nearestDistrict;
          db(table)
            .select('district_id', db.raw(distanceString))
            .orderBy('distance', 'asc')
            .limit(1)
          .then(function(result) {
            nearestDistrict = result[0].district_id;
            res.json(nearestDistrict);
          })
          .catch(err => {console.error(err);});
        }
      })
      .catch(err => {console.error(err);})
  });

/**
 * Get all the districts Vote Forward is targeting.
 */
router.route('/get-districts')
  .get(function(req, res) {
    db('districts')
      .then(function(result) {
          res.json(result);
        })
      .catch(err => {console.error(err);})
  });

/**
 * Get all the districts Vote Forward is targeting...but with stats!
 */
router.route('/get-districts-with-stats')
  .get(function(req, res) {
    db('districts_with_stats')
      .then(function(result) {
          res.json(result);
        })
      .catch(err => {console.error(err);})
  });

/**
 * Look up a district.
 */
router.route('/lookup-district')
  .get(rateLimits.lookupDistrictRateLimit, function(req, res) {
    if (JSON.parse(req.query.get_adoption_details) == true){
      db.raw(`select
        count(users.id) as num_users_using_district,
        voters_agg.voters_available,
        voters_agg.voters_adopted,
        voters_agg.letters_prepped,
        voters_agg.letters_sent,
        districts.district_id,
        districts.state,
        districts.state_abbr,
        districts.district_num,
        districts.description,
        districts.display_name,
        districts.why_this_district,
        districts.url_election_info,
        districts.url_wikipedia,
        districts.url_ballotpedia,
        districts.url_swingleft,
        districts.lat,
        districts.long,
        districts.return_address,
        districts.ra_city,
        districts.ra_state,
        districts.ra_zip
        from districts
        left join users
        on districts.district_id = users.current_district
        left join (
            select
            sum(available) voters_available,
            sum(adopted) voters_adopted,
            sum(prepped) letters_prepped,
            sum(sent) letters_sent,
            district_id
            from (
                select
                district_id,
                case when adopted_at is null
                    and confirmed_prepped_at is null
                    and confirmed_sent_at is null then 1
                    else 0
                end as available,
                case when adopted_at is not null
                    and confirmed_prepped_at is null
                    and confirmed_sent_at is null then 1
                    else 0
                end as adopted,
                case when confirmed_prepped_at is not null
                    and confirmed_sent_at is null then 1
                    else 0
                end as prepped,
                case when confirmed_prepped_at is not null
                    and confirmed_sent_at is not null then 1
                    else 0
                end as sent
                from voters
                where district_id = ?
            ) voters_case
            group by district_id
        ) voters_agg
        on districts.district_id = voters_agg.district_id
        where districts.district_id = ?
        group by voters_agg.voters_available, voters_agg.voters_adopted, voters_agg.letters_prepped, voters_agg.letters_sent, districts.district_id, districts.state, districts.state_abbr, districts.district_num, districts.description,districts.display_name,districts.why_this_district, districts.url_election_info, districts.url_wikipedia, districts.url_ballotpedia, districts.url_swingleft, districts.lat, districts.long, districts.return_address, districts.ra_city, districts.ra_state, districts.ra_zip;`,
        [req.query.district_id, req.query.district_id]
        )
      .then(function(result) {
      if (result['rows'].length === 0) {
          res.json(false);
        } else {
          res.json(result['rows']);
        }
      })
      .catch(err => {console.error(err);})
    } else {
      db('districts')
        .where({ district_id: req.query.district_id })
        .then(function(result) {
          if (result.length === 0) {
            res.json(false);
          } else {
            res.json(result);
          }
        })
        .catch(err => {console.error(err);})
    }
  });

/**
 * Check that the logged in user is an admin.
 */
function checkAdmin(req, res, next) {
  if (!req.user || !req.user.sub) {
    next(new checkJwt.UnauthorizedError('credentials_required',
      { message: 'No authorization token was found' }));
    return;
  }

  const auth0_id = req.user.sub;
  userService.isAdmin(auth0_id, function (error, isAdmin) {
    if (error) {
      next(error);
      return;
    }
    if (!isAdmin) {
      // Normally, we would send back a 401 or a 403, but if we don't want to
      // expose that this is a real route, then send back a 404.
      res.status(404).send('Not found');
      return;
    }
    next();
  });
}

router.route('/s/updateUserQualifiedState')
  .post(checkJwt, checkAdmin, function(req, res) {
    const auth0_id = req.body.auth0_id;
    const qualState = req.body.qualState;
    if (!auth0_id || !qualState) {
      res.status(400).end();
      return;
    }

    userService.updateUserQualifiedState(auth0_id, qualState, function (error, newState){
      if (error) {
        console.error(error);
        res.status(500).end();
        return;
      }
      res.status(200).send('User Qual State Updated.').end();
      return;
    });
  });

router.route('/s/batchApprovePending')
  .post(checkJwt, checkAdmin, function(req, res) {
    console.log("Batch approving pending.");
    userService.batchApprovePending(function (error, newState){
      if (error) {
        console.error(error);
        res.status(500).end();
        return;
      }
      res.status(200).send('Batch approved pending.').end();
      return;
    });
  });

// Check that a user is an admin.  You have to be an admin to do so, but you can
// check on another user.
router.route('/s/isAdmin')
  .get(checkJwt, checkAdmin, function(req, res) {
    const auth0_id = req.query.auth0_id;
    if (!auth0_id) {
      res.status(400);
      return;
    }
    userService.isAdmin(auth0_id, function (error, isAdmin) {
      if (error) {
        console.error(error);
        res.status(500);
        return;
      }
      res.json({ is_admin: isAdmin });
    });
  });

router.route('/s/users')
  .get(checkJwt, checkAdmin, function(req, res) {
    db('users')
      .then(function(result) {
        // Add in the voter summary data for the users
        voterService.getAdoptedVoterSummary(function(error, summary) {
          if (error) {
            console.error(error);
            res.status(500);
            return;
          }
          let summaryByAdopter = summary.reduce((a, s) => {
            a[s.adopter_user_id] = s;
            return a;
          }, {});
          let users = result.map(u => {
            u.stats = summaryByAdopter[u.auth0_id];
            return u;
          });
          res.json(users)
        });
      })
      .catch(err => {console.error(err);})
  });

router.route('/s/stats')
  .get(checkJwt, checkAdmin, function(req, res) {
    voterService.getVoterSummaryByDistrict(function(error, summary) {
      if (error) {
        console.error(error);
        res.status(500);
        return;
      }
      res.json(summary);
    });
  })

//Use router configuration at /api
app.use('/api', router);

app.get('*', function (request, response){
  response.sendFile(path.resolve(__dirname, '..', 'build', 'index.html'))
})

//start server and listen for requests
var server = app.listen(port, function() {
  console.log(`api running on port ${port}`);
});

module.exports = server;
