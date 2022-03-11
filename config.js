//exports.optValidator = optValidator;
exports.readConfig = readConfig;
exports.readjson = readjson;

require('json5/lib/register');

const fs = require('fs');
function readjson(filename){
    var r = {}
    if( ! filename ) return r;
    try {
        fs.accessSync(filename, fs.constants.R_OK);
        r = JSON.parse(fs.readFileSync(filename, 'utf8'));
        }
    catch (err) {
        //console.log(err);
        console.log('config.js/readjson: no or bad jsonfile, return r='+r);
        }
    return r;
    }

function readConfig (filename) {
    const opts = require('./'+filename);
    if ( filename.endsWith('json') ){
        opts.configname = filename.substring(0,filename.length-5);
        }
    else if ( filename.endsWith('json5') ){
        opts.configname = filename.substring(0,filename.length-6);
        }
    else opts.configname = filename;

    opts.errors = [];
    optValidator(opts);
    if( opts.errors.length > 0 ) {
        console.log('Config validation errors:\n' + JSON.stringify(opts.errors, null, 2));
        console.log('---.')
        }

    return opts;
    }

function optValidator(opts) {
    if( opts.moxa ){
        opts.moxa.connecttimeout = Math.max( 0, Math.min(59, opts.moxa.connecttimeout) );
        }
    if( opts.loraserver ){
        if( ! opts.loraserver.keepaliveInterval ){
            opts.errors.push({msg:'missing loraserver.keepaliveInterval, set to 30000 msec'});
            opts.loraserver.keepaliveInterval = 30000;
            }    
        }
    }
