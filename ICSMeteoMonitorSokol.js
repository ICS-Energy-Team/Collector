//'use strict';

/*
  Meteostation sokol-M1 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru

  Параметры порта 6.10.5 страница 29
*/

const CollectorName = "MeteoMonitor Sokol v. 0.9";
console.log("Hello! Starting " + CollectorName + " at " + Date());


// read config
const readConfig = require('./config.js').readConfig;
var opts = readConfig(process.argv[2]);

SokolConfig = opts.meteo.find( (el) => { return el.model == "SOKOL-M1"; });

// Connection
var dataJob;
const net = require('net');
var client = new net.Socket();
//const SerialPort = require('serialport');
//const client = new SerialPort('COM5', {
//  baudRate: SokolConfig.baudRate
//})

const schedule = require('node-schedule');
function connect(){
    console.log( "try to connect to " + SokolConfig.port +':'+ SokolConfig.host );
    client.connect(SokolConfig.port, SokolConfig.host,
        function(){
            console.log('CONNECTED TO: '+SokolConfig.host+':'+SokolConfig.port);
            dataJob = schedule.scheduleJob(`*/${SokolConfig.datainterval} * * * * *`, send);
        });
    }

// It starts.
connect();

// send request
const crc16 = require('crc').crc16modbus;
var message = requestcmd(SokolConfig.netaddress);
function send(){
    client.write(message);
    }

function consttest(){
    var buf = Buffer.from([0x01,0x03,0x00,0x00,0x00,0x0C,0x45,0xCF]);
    //var buf = Buffer.from("01030000000C45CF","hex");
    return buf;
    }

function requestcmd(id){
    var buf = Buffer.from([id, 0x03,0x00,0x00,0x00,0x0C, 0x00,0x00]);
    var vcrc = crc16(buf.slice(0, buf.length-2));
    buf.writeUInt16LE(vcrc, buf.length-2);
    return buf;
    }

// get and send date
var datas = [];
const Publisher = require('./ICSpublish.js');
var iot = new Publisher(opts);

client.on('data',function(buf){
    var endmoment = +new Date();
    console.log("data length:" + buf.length);
    console.log("data: " + buf.toString('hex'));

    //datas.push(buf);

    // check CRC
    if ( buf.readUInt16LE(buf.length-2) != crc16(buf.slice(0, buf.length-2)) ) {
        return sayError({error:"ERROR", message:"CRCFAIL", data: buf.toString('hex')});
        }

    // read info
    var info = getSokolInfo(buf);

    // send to IoT servers
    var datatosend = {ts: endmoment, devEui: SokolConfig.tbDevEui, values: info};
    iot.sendevent(opts.iotservers, SokolConfig.tbDevEui, datatosend);

    });


function getSokolInfo(buf){
    var info = {};
    try{
    for ( i = 9 ; i < buf.length ; i++ ) {
        switch (i) {
            case 0: // device address
            case 1: // command code
            case 2: // bytes in load
            case 3: // errors, type, ...
            case 4: // firmware version
            case 5: // UNIX time...
            case 6: // UNIX time...
            case 7: // UNIX time...
            case 8: // UNIX time...
                break;
            case 9:
                info.temperature = buf.readInt16BE(i) / 100; // C
                i++; break;
            case 11:
                info.pressure = buf.readUInt16BE(i) * 10; // Pa
                i++; break;
            case 13:
                info.humidity = buf.readUInt16BE(i); // %
                i++; break;
            case 15:
                info.windspeed = buf.readUInt16BE(i) / 100; // m/s
                i++; break;
            case 17:
                info.winddirection = buf.readUInt16BE(i); // degree
                i++; break;
            case 19:
                info.rainfall = buf.readUInt16BE(i) / 10; // mm
                i++; break;
            case 21:
                info.ultraviolet = buf.readUInt16BE(i) / 100 ; // W/m^2
                i++; break;
            case 23:
                info.illumination = buf.readUInt16BE(i) ; // 1 lux
                i++; break;
        }
    }}
    catch(e){
        console.err('Error in getSokolInfo while parsing data from SOKOL meteostation');
        console.err(e);
    }

    return info;
}

// Add a 'close' event handler for the client socket
client.on('close', function(hadError) {
    if( hadError ){ console.log('socket had transmission error'); }
    console.log('Connection closed. Exit');
    process.emit('SIGTERM');
    });
client.on('error', function(err) {
    console.log(err)
    sayError(ERROR,'Socket client',err);
    });
process.on('SIGTERM',()=>{
    try{
        console.log('TERM');
        client.destroy();
        //iot.closeconnectors();
        }
    finally{
        process.exit();
        }
    });
process.on('SIGINT',()=>{
    console.log('INT, exit.');
    process.emit('SIGTERM');
    });

function sayError(errdata) {
    if( errdata === undefined ) return;
    console.log('ERROR: ' + errdata.error + ' . ' + errdata.message);
    if( errdata.data ) console.log('Data: ' + errdata.data);
    //if( typeof obj !== "undefined" ) console.log(obj);
    }
    
/*
> var buf = Buffer.from([0x01,0x03,0x00,0x00,0x00,0x0C,0x45,0xCF]);
undefined
> port.write(buf);
true
> <Buffer 01 03 18 00 01 00 00 3b 14 09 60 26 6f 00 16 00 00 00 42 00 00 00 00 00 11 00 00 75 33>
*/