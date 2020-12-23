'use strict';

const crc16 = require('crc').crc16modbus;

/*
  Mercury234 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

// Now only for command 63h
class Mercury234{
    constructor(common, mode = 'SEARCH'){
        this._version = "MercuryMonitor v. 1.7 for Mercury 234";
        this._versiondate = "23 Dec 2020";
        // FAST - моментальные значения: ускоренное измерение
        // ACTIVEPWR - накопленные значения активной энергии по фазам
        // REACTPWR - накопленные значения реактивной энергии по квадрантам
        this.Common = common;
        this._commands = {'FAST': '0816A0', 'ACTIVEPWR': '056000', 'REACTPWR':'150000', 'ADMIN':'0102020202020202'};
        this._runningcmd = 'FAST';
        this._searchdelay = common.moxa.Mercury234.searchdelay;
        this._cmdmintimeout = common.moxa.Mercury234.mintimeout;
        this._cmdmaxtimeout = common.moxa.Mercury234.maxtimeout;
        this.MIN_DEVICE_ID = 1;
        this.MAX_DEVICE_ID = 250;

        //'081411', '056000', '156000': U, Pcumul, Qcumul,

        this._requested_devices = [];
        this._mode = mode;
        if ( mode == 'SEARCH' ) {
            this.request = this._search;
            this.parse = this._parseSearch;
            this._devices = [];
            common.moxa.Mercury234.devices = [];
            this._i = this.MIN_DEVICE_ID;
            }
        else if ( mode == 'COLLECT' ) {
            this.request = this._request;
            this.parse = this._parseAnswer;
            this._devices = common.moxa.Mercury234.devices;
            this._i = -1;
            }
        else if ( mode == 'LONGSEARCH' ) {
            this.request = this._longsearch;
            this.parse = this._parseSearch;
            this._devices = [];
            this._i = this.MIN_DEVICE_ID;
            this._tick = false;
            }
        }

    _search(){
        if( this._i > this.MAX_DEVICE_ID ){
            this._i = -1;
            this._devices = [...new Set(this._devices)]; // get only unique IDs
            this.Common.moxa.Mercury234.devices.push(...this._devices);
            if( this._devices.length === 0 ) {
                console.log( "I haven't found any devices. I have to halt collector due to config" );
                return "EXIT";
            }
            console.log("Found "+this._devices.length+" devices: "+this._devices);
            return "DELETE"
            }
        this._i += 1;
        return {request: requestcmd(this._i,this._commands['ADMIN']), timeout: this._searchdelay };
        }

    _request(){
        if( this._i == -1 ) {
            console.log('REQUEST ALL ' + this._devices.length + ' DEVICES: ' + this._devices);
            }

        this._i += 1;
        if( this._i >= this._devices.length ) {
            this._i = -1;
            return "END";
            }

        let d = this._devices[this._i];
        this._requested_devices.push(d);
        return {
            request: requestcmd(d,this._commands[this._runningcmd]), 
            timeout: this._cmdmaxtimeout
            };
        }

    _longsearch(){
        if( this._i > this.MAX_DEVICE_ID )
            this._i = this.MIN_DEVICE_ID;

          /* this._i = -1;
            let A = new Set(this._devices), B = new Set(Common.devices);
            let AdiffB = A.filter(function(x) { return B.indexOf(x) < 0 });
            this.Common.devices = this._devices;
            return "DELETE"*/
            
        if( this._tick ) {
            if ( this._devices.length == 1 ) {
                if ( !this.Common.moxa.Mercury234.devices.includes(this._devices[0]) ){
                    this.Common.moxa.Mercury234.devices.push(this._devices[0]);
                    }
                }
            console.log("Mercury234parser. Found " + this._devices.length + " devices when in _longsearch");
            this._devices = [];
            this._tick = false;
            return "END";
            }

        this._i += 1;
        this._tick = true;
        return {request: requestcmd(this._i,this._commands['ADMIN']), timeout: this._searchdelay };
        }
    
    _parseSearch(buf){
        if( buf.length < 2 )
            return sayError(RESPLESS2);

        var dID = buf.readUInt8(0);

        // check CRC
        if ( buf.readUInt16LE(buf.length-2) != crc16(buf.slice(0, buf.length-2)) ) {
            return sayError(CRCFAIL,'search', {id: dID, datalen : buf.length});
            }

        // for filling deviceID table mode
        this._devices.push(dID);
        return {};
        }

    _parseAnswer(buf){
        if( buf.length < 2 )
            return sayError(RESPLESS2);//console.log('RECEIVED response of length < 2.');
    
        var dID = buf.readUInt8(0);
    
        // check CRC
        if ( buf.readUInt16LE(buf.length-2) != crc16(buf.slice(0, buf.length-2)) ) {
            let er = 'id=' + dID + ' reqdevice=' + this._devices[this._i];
            return sayError(CRCFAIL, er, {datalen : buf.length, data: buf.toString('hex')});
            }
    
        // ok we have sensor data receive mode
        var timeout = this._cmdmaxtimeout;
        let ii = this._requested_devices.indexOf(dID);
        if( ii != -1 ) {
            this._requested_devices.splice(ii,1);
            timeout = this._cmdmintimeout;
            }
        else {
            return sayError(ERROR,'dID not in RequestedDevices');
            }
    
        var devEui = 'MOXA' + this.Common.moxa.name.slice(-4) +
                    'MR234-' + ('000000'+dID.toString(10)).slice(-6);
        /* assert(msg.length == 20); */
    
        //console.log('Parsing command '+ runningcommand +'...');
        var cmd = this._runningcmd;
            {
            let curcommand = 'BAD';
            if( buf.length === 15 ) { curcommand = 'ACTIVEPWR'; }
            else if ( buf.length === 19 ) { curcommand = 'REACTPWR'; }
            else if ( buf.length === 89 ) { curcommand = 'FAST'; }
            if ( curcommand == 'BAD' )
                return sayError(BADSENSDATA,'buffer: '+buf.toString('hex'),{len:buf.length});
            if ( curcommand != cmd )
                return sayError(DIFFCMD,"curcommand == "+curcommand+ " != runningcommand == " + cmd,
                        { datalen : buf.length, device : msg.devEui });
            }
    
        var sensordata = null;
        switch ( cmd ) {
            case 'FAST': // моментальные значения: ускоренное измерение
                sensordata = {  PT: readPowerValue(buf, 1, 'P')/100,   P1: readPowerValue(buf, 4, 'P')/100,   P2:readPowerValue(buf, 7, 'P')/100,
                                P3: readPowerValue(buf, 10, 'P')/100,  QT: readPowerValue(buf, 13, 'Q')/100,  Q1:readPowerValue(buf, 16, 'Q')/100,
                                Q2: readPowerValue(buf, 19, 'Q')/100,  Q3: readPowerValue(buf, 22, 'Q')/100,  ST:readPowerValue(buf, 25, 'S')/100,
                                S1: readPowerValue(buf, 28, 'S')/100,  S2: readPowerValue(buf, 31, 'S')/100,  S3:readPowerValue(buf, 34, 'S')/100,
                                U1: read3byteUInt(buf, 37)/100,        U2: read3byteUInt(buf, 40)/100,        U3:read3byteUInt(buf, 43)/100,
                                alpha1: read3byteUInt(buf, 46)/100,    alpha2: read3byteUInt(buf, 49)/100,    alpha3:read3byteUInt(buf, 52)/100,
                                I1: read3byteUInt(buf, 55)/1000,       I2: read3byteUInt(buf, 58)/1000,       I3:read3byteUInt(buf, 61)/1000,
                                phiT: readPowerValue(buf, 64, 'Q')/1000,       phi1: readPowerValue(buf, 67, 'Q')/1000,       phi2: readPowerValue(buf, 70, 'Q')/1000, phi3:readPowerValue(buf, 73, 'Q')/1000,
                                frequency: read3byteUInt(buf, 76)/100,
                                harmonic1: buf.readUInt16LE(79)/100,   harmonic2: buf.readUInt16LE(81)/100,   harmonic3: buf.readUInt16LE(83)/100,
                                T: buf.readUInt16LE(85)/100
                            };
                break;
            case 'ACTIVEPWR': // накопленные значения активной энергии по фазам
                sensordata = { Aplus1: read4byteUInt(buf, 1), Aplus2: read4byteUInt(buf, 5), Aplus3: read4byteUInt(buf, 9) };
                break;
            case 'REACTPWR': // накопленные значения реактивной энергии по квадрантам
                sensordata = { R1: read4byteUInt(buf, 1), R2: read4byteUInt(buf, 5), R3: read4byteUInt(buf, 9), R4: read4byteUInt(buf, 13) };
                break;
            }

        return {devEui: devEui, values: sensordata, timeout: timeout};
        }
}

module.exports = Mercury234;

const ERROR = 0, RESPLESS2 = 1, CRCFAIL = 2, DIFFCMD = 3, RESPBAD = 4, BADSENSDATA = 5
var myerrors = {};
myerrors[ERROR] = 'descr';
myerrors[RESPLESS2] = 'RECEIVED response of length < 2';
myerrors[CRCFAIL] = 'CRC FAIL';
myerrors[DIFFCMD] = 'Different commands';
myerrors[RESPBAD] = 'RECEIVED BAD response';
myerrors[BADSENSDATA] = 'Bad encoded sensor data';
function sayError(i, str, obj) {
    if( i < 0 || i >= myerrors.length ) return;
    if( typeof str === "undefined" ) str = '';
    var a = {error: myerrors[i], message: str};
    if( typeof obj !== "undefined" ) a.data = obj;
    return a;
    }    

function requestcmd(dID,cmd){
    var outHex = Buffer.from([dID]).toString('hex') + cmd;
    var crcHex = ('0000'+crc16(Buffer.from(outHex,'hex')).toString(16)).slice(-4); // crc for this command
    var outgoingMessage = Buffer.from( outHex+crcHex.substr(2,2)+crcHex.substr(0,2),'hex' );
    return outgoingMessage;
    }
      
function readPowerValue(data, offset, powertype) {
    //console.log('readPowerValue');
    var p = ((data.readUInt8(offset)&0x3F) <<16) + data.readUInt16LE(offset+1);
    //      if ((data.readUInt8(offset)&0x80)!=0 && powertype=='P') { p *= -1; }
    if ((data.readUInt8(offset)&0x40)==0 && powertype=='Q') { p *= -1; }
    return p;
    }

// read 3-byte Int from the string starting from offset
function read3byteUInt(data, offset) {
    //console.log('read3byteUInt');
    return (data.readUInt8(offset) <<16) + data.readUInt16LE(offset+1);
    }

function read4byteUInt(data, offset) {
    //console.log('read4byteUInt');
    return (data.readUInt16LE(offset) <<16) + data.readUInt16LE(offset+2);
    }
  