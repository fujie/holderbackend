require('dotenv').config();
const express = require('express');
const passport = require('passport');
const config = require('./config/authn_config.json');
const BearerStrategy = require('passport-azure-ad').BearerStrategy;
const msal = require('@azure/msal-node');
var fetch = require( 'node-fetch' );

// Todo change scopes
const EXPOSED_SCOPES = [ "demo.read" ]
const options = {
    identityMetadata: `https://${config.metadata.b2cDomain}/${config.credentials.tenantName}/${config.policies.policyName}/${config.metadata.version}/${config.metadata.discovery}`,
    clientID: config.credentials.clientID,
    policyName: config.policies.policyName,
    isB2C: config.settings.isB2C,
    validateIssuer: config.settings.validateIssuer,
    loggingLevel: config.settings.loggingLevel,
    passReqToCallback: config.settings.passReqToCallback,
    scope: EXPOSED_SCOPES
}

const bearerStrategy = new BearerStrategy(options, (token, done) => {
        // Send user info using the second argument
        done(null, { }, token);
    }
);
passport.use(bearerStrategy);

///////////////////////////////////////////////////////////////////////////////////////
// MSAL configuration for obtaining access_token to execute Entra Verified ID APIs
const msalConfig = {
  auth: {
      clientId: process.env.vcApp_client_id,
      authority: 'https://login.microsoftonline.com/' + process.env.vcApp_azTenantId,
      clientSecret: process.env.vcApp_client_secret,
  }
};
const cca = new msal.ConfidentialClientApplication(msalConfig);
const msalClientCredentialRequest = {
  scopes: [process.env.vcApp_scope],
  skipCache: false
};


const app = express();

//enable CORS (for testing only -remove in production/deployment)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Todo create API endpoints
// API endpoint
app.get('/api',
    passport.authenticate('oauth-bearer', {session: false}),
    (req, res) => {
        console.log('Validated claims: ', req.authInfo);
        res.status(200).json({'name': req.authInfo['name']});
    }
);

app.get('/api/createPresentationRequest',
    passport.authenticate('oauth-bearer', {session: false}),
    async (req, res) => {
        // id = req.session.id;
        var id = "hogehoge";
        // get access_token to access Entra Verified ID's Client API
        var accessToken = "";
        try {
            const result = await cca.acquireTokenByClientCredential(msalClientCredentialRequest);
            if ( result ) {
            accessToken = result.accessToken;
            }
        } catch {
            console.log( "failed to get access token" );
            res.status(401).json({
                'error': 'Could not acquire credentials to access your Azure Key Vault'
                });  
            return; 
        }
        // call Entra Verified ID API to create presentation request
        // Load presentation template
        var requestConfigFile = process.env.presentation_requestTemplate;
        var presentationConfig = require( requestConfigFile );
        // authority
        presentationConfig.authority = process.env.verifier_authority;
        // registration
        presentationConfig.registration.clientName = process.env.presentation_registration_clientName;
        // callback
        presentationConfig.callback.url = process.env.baseURL + '/api/verifier/presentation-request-callback';
        presentationConfig.callback.state = id;
        if ( presentationConfig.callback.headers ) {
            presentationConfig.callback.headers['api-key'] = process.env.presentation_request_callbackAPIKey;
        }
        // requestedCredentials
        presentationConfig.requestedCredentials[0].type = process.env.presentation_request_type;
        presentationConfig.requestedCredentials[0].purpose = process.env.presentation_request_purpose;
        presentationConfig.requestedCredentials[0].acceptedIssuers[0] = process.env.presentation_request_acceptedIssuers;

        console.log( 'Invoke VC Presentation Request API' );
        var payload = JSON.stringify(presentationConfig);
        console.log( payload );
        const fetchOptions = {
            method: 'POST',
            body: payload,
            headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length.toString(),
            'Authorization': `Bearer ${accessToken}`
            }
        };

        var client_api_request_endpoint = 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials/createPresentationRequest';
        const response = await fetch(client_api_request_endpoint, fetchOptions);
        var resp = await response.json()

        resp.id = id;
        console.log( 'VC Client API Response' );
        console.log( resp );  
        res.status(200).json(resp);

    }
)

const port = process.env.PORT || 20000;

app.listen(port, () => {
    console.log('Listening on port ' + port);
});

module.exports = app;
