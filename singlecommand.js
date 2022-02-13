'use strict';
const net = require('net');

var host = process.argv[2];
var port = process.argv[3];
var address = process.argv[4];
var cmd = process.argv[5];
var cmdarg1 = parseInt(process.argv[6]);
if( isNaN(cmdarg1) ) cmdarg1 = 0;

// node singlecommand.js 10.101.0.50 4002 45 MONTHENERGY 1 - энергия за январь со счётчика №45 по адресу 10.101.0.50:4002

const Merc234 = require('./Mercury234parser');
const merc = new Merc234(null,'SIMPLE');


var client = new net.Socket();

client.on('data', function(buf) { // not asynchronous!!
    console.log('Send command: ' + merc.getCommand(address,cmd,cmdarg1).toString('hex'));
    console.log('Output buffer: ' + buf.toString('hex'));
    console.log('Output buffer length: ' + buf.length);
    console.log('Output object: ');
    console.dir( merc.parseRequest(cmd,buf) );
    process.emit('SIGINT');
    });

function connect(){
    if ( client.connecting ) client.destroy();
    client.connect(port, host, function() {
        console.log('CONNECTED TO: '+ host + ':' + port);
        client.write(merc.getCommand(address,cmd,cmdarg1));
      });
    }

process.on('SIGINT',()=>{
    client.end();
    client.destroy();
    process.exit();
    })


connect();
