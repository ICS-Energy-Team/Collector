//exports.optValidator = optValidator;
exports.readConfig = readConfig;

require('json5/lib/register');

function readConfig (filename) {
    opts = require('./'+filename);
    if ( filename.endsWith('json') ){
        opts.configname = filename.substring(0,filename.length-5);
        }
    else if ( filename.endsWith('json5') ){
        opts.configname = filename.substring(0,filename.length-6);
        }
    else opts.configname = filename;

    opts.errors = [];
    optValidator(opts);
    return opts;
    }

function optValidator(opts) {
    if( opts.moxa ){
        opts.moxa.connecttimeout = Math.max( 0, Math.min(59, opts.moxa.connecttimeout) );
        }
    if( ! opts.loraserver?.datacheckinterval ){
        opts.errors.push({msg:'missing loraserver.datacheckinterval, set to 30 sec'});
        opts.loraserver.datacheckinterval = 30;
        opts.loraserver.datacheckintervalunit = 's';
        }
    if( ! opts.loraserver?.datacheckintervalunit ){
        opts.errors.push({msg:'missing loraserver.datacheckintervalunit, set to sec'});
        opts.loraserver.datacheckintervalunit = 's';
        }
    
    }