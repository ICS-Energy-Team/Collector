'use strict';
const net = require('net');
const crc16 = require('crc').crc16modbus;

var host = process.argv[2];
var port = process.argv[3];
var address = process.argv[4];

var SNcmd = '0800';

var client = new net.Socket();

connect();

client.on('data', function(buf) { // not asynchronous!!
    var s = twodigit(buf.readUInt8(1)) + twodigit(buf.readUInt8(2)) + twodigit(buf.readUInt8(3)) + twodigit(buf.readUInt8(4));
    console.log('S/N of RS485 address '+ address + ' is ' + s);
    process.emit('SIGINT');
    });

function twodigit(a){
    return ('00'+a.toString()).slice(-2);
    }

function connect(){
    if ( client.connecting ) client.destroy();
    client.connect(port, host, function() {
        console.log('CONNECTED TO: '+ host + ':' + port);
        client.write(requestcmd(address,SNcmd));
      });
}

function requestcmd(dID,cmd){
    var outHex = Buffer.from([dID]).toString('hex') + cmd;
    var crcHex = ('0000'+crc16(Buffer.from(outHex,'hex')).toString(16)).slice(-4); // crc for this command
    var outgoingMessage = Buffer.from( outHex+crcHex.substr(2,2)+crcHex.substr(0,2),'hex' );
    return outgoingMessage;
    }

process.on('SIGINT',()=>{
    client.end();
    client.destroy();
    process.exit();
    })