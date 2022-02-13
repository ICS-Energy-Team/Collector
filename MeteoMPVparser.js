'use strict';

const crc16 = require('crc').crc16modbus;

/*
  Meteo MPV-702 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

class MeteoMPV{
    constructor(device){
        this._version = "MeteoMonitor v. 0.9 for MPV-702";
        this._versiondate = "07 Jun 2021";
        //this._device = device;
        this.parse = this._parseAnswer;
        }
    
    active() { return true; }

    _parseAnswer(buf){
        const datastr = buf.toString();
        //console.log(datastr);
        var sensordata = {};
    
        for ( const el of datastr.split("\n") ) {
            let info = el.split(',')
            if ( info[0] == '$WIMWV' ) {
                sensordata['WindDirection'] = parseFloat(info[1]);
                sensordata['WindSpeed'] = parseFloat(info[3]); 
                }
            else if( info[0] == '$WIMMB' ) {
                sensordata['BaroPressure'] = parseFloat(info[3]); 
                }
            else if( info[0] == '$WIMHU' ) {
                sensordata['Humidity'] = parseFloat(info[1]);
                sensordata['DewPoint'] = parseFloat(info[3]); 
                }
            else if( info[0] == '$WIMTA' ) {
                sensordata['Temperature'] = parseFloat(info[1]);
                }
            }//for

        if ( Object.getOwnPropertyNames(sensordata).length === 0 )
            return { error:'MeteoMPVparser.js Error', message:'on data listener: There is no data' };

        return sensordata;
        }

}


function sayError(errdata) {
    if( errdata.data ) errdata.data = JSON.stringify(errdata.data, null, 2);
    //if( typeof obj !== "undefined" ) console.log(obj);
    return errdata;
    }
    

module.exports = MeteoMPV;

/*// answer to 63h command
    > ask(DeviceIDs[1]);
    WROTE: 027cf85b63beb8
    undefined
// answer: ADDR CMD U-I-P CRC
    > 027cf85b 63 2142 0000 000000 7b53
                  2153 0000 000001
                  2157
                  2141
                  2150
                  2147
                  2174
              4221 = 0100 0010 0010 0001
              5321 = 0101 0011 0010 0001
              5721 = 0101 0111 0010 0001
              7421 = 0111 0100 0010 0001

0010 0001 0100 0010 = 214,2
0010 0001 0101 0011 = 215,3
0010 0001 0101 0111 = 215,7
0010 0001 0111 0100 = 217,4*/
