'use strict';

/*
  Wirenboard collector.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "WirenboardCollector v. 0.1";
const CollectorVersionDate = "15 Jan 2021";
console.log("Hello! Starting " + CollectorName + " at " + Date());
if( process.argv.length < 3 ) {
    console.log('Please specify JSON config name as first argument of script');
    process.exit(1);
}

// read options
const readConfig = require('./config.js').readConfig;
var opts = readConfig(process.argv[2]);

// iot - for publish to IoT platforms
const Publisher = require('./ICSpublish.js');
var iot = new Publisher(opts);


var mqtt = require('mqtt');
var client  = mqtt.connect('mqtt://'+opts.wirenboard.host);

client.on('error', function (error) {
  // message is Buffer
  console.log(error)
  //client.end()
  })

client.on('connect', function () {
    console.log('connect');
    
    for( let k in opts.wirenboard.topics ) {
        client.subscribe(k, function (err) {
            if (!err) {
                console.log('Have subscribed to '+k+' topic');
                }
            else console.log(err);
            })
        }
    })

client.on('message', function (topic, message) {
    // message is Buffer
    console.log('have message: '+topic + ' ' + message.toString());
    if( opts.wirenboard.topics.hasOwnProperty(topic) ){
        let t = opts.wirenboard.topics[topic];
        let moment = +new Date();
        let data = {};
        data[t.name] = parseFloat(message.toString());
        let datatosend = {ts: moment, devEui: t.devEUI, values: data};
        iot.sendevent(opts.iotservers, t.devEUI, datatosend);
        }
    
    })


// Add a 'close' event handler for the client socket
client.on('close', function() {
    sayLog('Connection closed');
    process.emit('SIGINT');
    });
client.on('error', function(err) {
    sayError({error:'Error in MQTT client',data:err});
    process.emit('SIGINT');
    });
process.on('SIGTERM',function() {
    try {
        console.log('TERM');
        client.end();
        iot.closeconnectors();
        }
    finally {
        process.exit();
        }
    });
process.on('SIGINT',function(){
    console.log('INT, then emit TERM');
    //setTimeout(stateClientMOXA,1000,ClientEvents.LOST_CONNECTION);
    process.emit('SIGTERM');
    });
process.on('uncaughtException', (err,origin)=>{
    try {
        const fs = require('fs');
        fs.writeSync(
            process.stderr.fd,
            `Caught exception: ${err}\n` +
            `Exception origin: ${origin}\n`
            );
        fs.writeSync(process.stdout.fd,'uncaughtException, exit');
        client.end();
        iot.closeconnectors();
        }
    finally{
        process.exit();
        }
    });

function sayError(errdata) {
    if( errdata === undefined ) return;
    console.log('ERROR: ' + errdata.error + ' . ' + errdata.message);
    if( errdata.data ) console.log('Data: ' + JSON.stringify(errdata.data, null, 2) );
    //if( typeof obj !== "undefined" ) console.log(obj);
    }

const LOG = 0;
var mylogs = {};
mylogs[LOG] = 'descr';
function sayLog(i,str,obj) {
    if( i < 0 || i >= mylogs.length ) return;
    if( typeof str === "undefined" ) str = '';
    console.log('LOG '+ i + ': ' + mylogs[i] + ' . ' + str);
    if( typeof obj !== "undefined" ) console.log('Data: '+ JSON.stringify(obj,null,2));
    }
