'use strict';

const crc16 = require('crc').crc16modbus;

/*
  Mercury234 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

class Mercury234{
    constructor(common, mode = 'SEARCH'){
        this._version = "MercuryMonitor v. 1.7 for Mercury 234";
        this._versiondate = "15 Jan 2020";
        // FAST - моментальные значения: ускоренное измерение
        // ACTIVEPOWER - накопленные значения активной энергии по фазам
        // REACTPOWER - накопленные значения реактивной энергии по квадрантам
        // DAYENERGY - total day active and reactive energy up to the current time
        this._commands = {'FAST': '0816A0', 'ACTIVEPOWER': '056000', 'REACTPOWER':'150000', 'ADMIN':'0102020202020202',
                        'SERIALNUMBER': '0800', 'DAYENERGY':'054000', 'MONTHENERGY': '053100', 'TIME': '0400'
                        };        //'081411', '056000', '156000': U, Pcumul, Qcumul,
        if ( mode == 'SIMPLE' ) {
            //this._twodigits = new Intl.NumberFormat('en-US',{minimumIntegerDigits:2})
            return;
            }
        
        this.Common = common;
        this._searchdelay = common.moxa.Mercury234.searchdelay;
        this._cmdmintimeout = common.moxa.Mercury234.mintimeout;
        this._cmdmaxtimeout = common.moxa.Mercury234.maxtimeout;
        this.MIN_DEVICE_ID = 1;
        this.MAX_DEVICE_ID = 250;
        this._requested_devices = [];

        this._mode = mode;
        this._EnergyModes = new Set(['ACTIVEPOWER', 'DAYENERGY', 'MONTHENERGY']);
        if ( mode == 'SEARCH' ) {
            this.request = this._search;
            this.parse = this._parseSearch;
            this._devices = [];
            if (typeof common.moxa.Mercury234.devices === 'undefined')
                common.moxa.Mercury234.devices = [];
            this._i = this.MIN_DEVICE_ID - 1;
            }
        else if ( mode == 'COLLECT' ) {
            this._runningcmd = 'FAST';
            this.request = this._request;
            this.parse = this._parseAnswer;
            this._devices = common.moxa.Mercury234.devices;
            this._i = -1;
            }
        else if ( mode == 'LONGSEARCH' ) {
            this.request = this._longsearch;
            this.parse = this._parseSearch;
            this._devices = [];
            this._i = this.MIN_DEVICE_ID - 1;
            this._tick = false;
            }
        else if ( this._EnergyModes.has(mode) ) {
            this._runningcmd = mode;
            this.request = this._longRequest;
            this.parse = this._parseAnswer;
            this._devices = common.moxa.Mercury234.devices;
            this._i = -1;
            this._tick = false;
            this._turnOn = true;
            if( mode == 'ACTIVEPOWER' ) common.plan.push({ func : this._wakeUp.bind(this), schedule : common.moxa.Mercury234.activepowerschedule });
            if( mode == 'DAYENERGY' ) common.plan.push({ func : this._wakeUp.bind(this), schedule : common.moxa.Mercury234.dayenergyschedule });
            if( mode == 'MONTHENERGY' ) {
                this._turnOn = false; // wait for schedule run
                common.plan.push({ func : this._wakeUp.bind(this), schedule : common.moxa.Mercury234.monthenergyschedule });
                }
            }
    
        }// constructor

    _search(){
        this._i += 1;
        if( this._i > this.MAX_DEVICE_ID ){
            this._i = this.MIN_DEVICE_ID - 1;
            this._devices = [...new Set(this._devices)]; // get only unique IDs
            if( this._devices.length === 0 ) {
                console.log( "I haven't found any devices. I have to halt collector due to config" );
                return "EXIT";
            }
            this.Common.moxa.Mercury234.devices.push(...this._devices);
            console.log("Found "+this._devices.length+" devices: "+this._devices);
            return "DELETE";
            }
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
        if( this._tick ) {
            this._endlongsearch();
            return "END";
            }

        this._i += 1;
        if( this._i > this.MAX_DEVICE_ID )
            this._i = this.MIN_DEVICE_ID;


        this._tick = true;
        return {request: requestcmd(this._i,this._commands['ADMIN']), timeout: this._searchdelay };
        }
    async _endlongsearch(){
        if ( this._devices.length == 1 ) {
            if ( !this.Common.moxa.Mercury234.devices.includes(this._devices[0]) ){
                this.Common.moxa.Mercury234.devices.push(this._devices[0]);
                }
            }
        console.log("Mercury234parser. Found " + this._devices.length + " devices when in _longsearch");
        this._devices = [];
        this._tick = false;
        }

    _wakeUp(){
        if ( ! this._EnergyModes.has(this._mode) ) return;
        console.log('mode '+this._mode+ " has woken up on "  + Date());
        this._turnOn = true;
        this._tick = false
        this._i = -1;
        if( this._mode == 'MONTHENERGY' ){
            let d = (new Date()).getMonth(); /* month fron 0(Jan) to 11(Dec) */
            /* Mercury read month energy command from 1(Jan) to 12(Dec)
                so we don't have to decrease d to get previous month
            */
            if ( d == 0 ) d = 12; // only this special case
            this._commands['MONTHENERGY'] = setmonthenergy(d);
            }
        }
    _longRequest(){ // one per datainterval request
        if( ! this._turnOn ) return "END";
        if( this._tick ) { // for only single run of this mechanism in one moxa.datainterval
            this._tick = false;
            return "END";
            }

        this._i += 1;

        if( this._i >= this._devices.length ) {
            this._turnOn = false;
            this._tick = false;
            this._i = -1;
            return "END";
            }

        this._tick = true;
        let d = this._devices[this._i];
        this._requested_devices.push(d);
        return {request: requestcmd(d,this._commands[this._runningcmd]), timeout: this._cmdmaxtimeout };
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
    
        var devEui = this.Common.moxa.name.slice(-10) +
                    '-MR234-' + ('000'+dID.toString(10)).slice(-3);
        /* assert(msg.length == 20); */
    
        //console.log('Parsing command '+ runningcommand +'...');   
        var sensordata = this.parseRequest(this._runningcmd,buf);
        if ( sensordata === null ){
            return sayError(RESPBAD, 'buffer: '+buf.toString('hex'), {buflen:buf.length, devEui: devEui});
            }
        var data = {devEui: devEui, values: sensordata, timeout: timeout};

        if( this._runningcmd === 'MONTHENERGY' ){
            data.correcttimestamp = - 2_419_200_000; // ms in 28 days ~ one month ago
            }

        return data;
        }// parseAnswer

    getCommand(id, cmd, arg){
        if ( cmd == 'MONTHENERGY')
            this._commands['MONTHENERGY'] = setmonthenergy(arg);
        return requestcmd(id, this._commands[cmd]);
        }
    parseRequest(cmd,buf){
        var res;
        switch( cmd ){
            case 'FAST': // моментальные значения: ускоренное измерение
                if( ! ( (buf.length === 89) || (buf.length === 98) ) ) { return null; }
                res = {  PT: readPowerValue(buf, 1, 'P')/100,   P1: readPowerValue(buf, 4, 'P')/100,   P2:readPowerValue(buf, 7, 'P')/100,
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
            case 'SERIALNUMBER':
                res = { SN: twodigits(buf.readUInt8(1)) + twodigits(buf.readUInt8(2)) + 
                        twodigits(buf.readUInt8(3)) + twodigits(buf.readUInt8(4)) };
                break;
            case 'ACTIVEPOWER': // накопленные значения активной энергии по фазам
                if( ! ( buf.length === 15 ) ) { return null; }
                res = { A1: read4byteUInt(buf, 1), A2: read4byteUInt(buf, 5), A3: read4byteUInt(buf, 9) };
                break;
            case 'REACTPOWER': // накопленные значения реактивной энергии по квадрантам
                if( ! ( buf.length === 19 ) ) { return null; }
                res = { R1: read4byteUInt(buf, 1), R2: read4byteUInt(buf, 5), R3: read4byteUInt(buf, 9), R4: read4byteUInt(buf, 13) };
                break;
            case 'DAYENERGY':
                if( ! ( buf.length === 19 ) ) { return null; }
                res = { Aday: (buf.readUInt16LE(1)<<16) + buf.readUInt16LE(3), Rday: (buf.readUInt16LE(9)<<16) + buf.readUInt16LE(11) };
                break;
            case 'MONTHENERGY':
                if( ! ( buf.length === 19 ) ) { return null; }
                res = { Amon: (buf.readUInt16LE(1)<<16) + buf.readUInt16LE(3), Rmon: (buf.readUInt16LE(9)<<16) + buf.readUInt16LE(11) };
                break;
            case 'TIME':
                res = { Time: buf.toString('hex',3,4)+':'+buf.toString('hex',2,3)+':'+buf.toString('hex',1,2)+' '+buf.toString('hex',5,6)+'/'+buf.toString('hex',6,7)+'/'+buf.toString('hex',7,8)};
                break;
            }
        return res;
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

function setmonthenergy(m){
    m = Math.max(1,Math.min(m,12));
    return '053'+ m.toString(16) +'00';
    }

function twodigits(i){
    return ('00'+i).slice(-2);
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
  