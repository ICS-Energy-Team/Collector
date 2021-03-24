'use strict';

const https = require('https');
const http = require('http');
const mqtt = require('mqtt');

const rfs = require("rotating-file-stream");

class Publisher{

    constructor(config){
        var iotservers = config.iotservers;
        iotservers.forEach(function(iotserver){
            if( iotserver.type == 'file' )
                {
                this._name = iotserver.name || config.configname;
                var compressvar = iotserver.compress || "gzip";
                var ext = 'log';
                if ( compressvar === "gzip" ) ext += '.gz';
                this._stream = rfs.createStream(`${this._name}.`+ext, {
                    interval: iotserver.interval || "1d", // rotate daily
                    maxFiles: iotserver.maxFiles || 15, // rotate 2+ weeks
                    compress: compressvar // compress rotated files
                    });
                }
            },this);
        
        /* for 'filesystem' IoT server :) */
        //const FileDump = {
        //    timer: 60000,//3600000, // hour in msec
        //    datainterval: 1, //sec
        //    devicescount: 30,
        this._overcount = 50;
        this._count = 1000;
        this._arrayLen = this._count; //FileDump.overcount
                        //+ Math.ceil(FileDump.timer/1000 / FileDump.datainterval) * FileDump.devicescount;
        this._dataArray = new Array(this._arrayLen);
        this._elem = 0;//, period = 0;        //var startts;

        this._devices = {};
        this._GreenPL = {};
        this._mqttclients = { count: 0, ended: 0 };
        }
    async sendevent(iotservers, devEui, datatosend) {
        var json = JSON.stringify(datatosend,null,2);
        var valuesjson = JSON.stringify(datatosend.values,null,2);
        //console.log('Device ID ' + devEui +': data "'  + json + '" sent to: \n');
        console.log('Device ID ' + devEui +' of timestamp '  + datatosend.ts + ' sent to:');

        //for all destinations
        iotservers.forEach(function(iotserver) {
          // assign destination server and port from runtime parameters with TB cloud as default
          if (iotserver.type == 'file'){
              //if( elem == 0 ) startts = datatosend.ts;
              this._dataArray[this._elem] = datatosend;
              this._elem++;
              //if( datatosend.ts - startts > FileDump.timer ){
              if( this._elem > this._arrayLen - this._overcount ){
                this.saveToFile( this._dataArray.slice(0,this._elem) );
                this._elem = 0;
                }
          } else if (iotserver.type == 'rightech') { // for rightech assume MQTT
              console.log('Rightech server by MQTT...');
              let mqclient = mqtt.connect('mqtt://'+iotserver.host+':'+iotserver.port, {clientId: devEui});

              mqclient.on('connect', function () {
                mqclient.publish('telemetry', valuesjson);
                mqclient.end();
                });

              mqclient.on('message', function (topic, message) {
                // message is Buffer
                console.log('Response from rightech server: '+ message.toString());
                mqclient.end();
                });
              mqclient.on('error', function (error) {
                console.log('Could not connect to rightech server with error: "'+error+'"');
                console.log('Flush MQTT channel to rightech server');
                mqclient.end();
                });
          } else if (iotserver.type == 'thingsboard') {
              let devToken = devEui;
              if( iotserver.hasOwnProperty('keys') && iotserver.keys.hasOwnProperty(devEui) ){
                  devToken = iotserver.keys[devEui];
                  }

              let teleoptions = {
                  host: iotserver.host,
                  port: iotserver.port,
                  path: '/api/v1/' + devToken + '/telemetry',
                  method: 'POST'
                  };

            if( iotserver.protocol == 'mqtt' ) {
                if ( this._devices.hasOwnProperty(devToken) ){
                  this._devices[devToken].sendalltime = datatosend.ts;
                  this._devices[devToken].connector.publish('v1/devices/me/telemetry', json, function(err){
                      if(err) {
                          var cli_str = "mqclientid "+ this._devices[devToken].connector.options.clientId;
                          console.log( cli_str + ", Cann't publish to TB, error:" + err);
                          }
                      });

                    /*// code for data economy when measurements doesn't change
                    if( datatosend.ts - devices[devToken].sendalltime >= iotserver.maxSilenceTime ){
                        devices[devToken].sendalltime = datatosend.ts;
                        let repeatdata = devices[devToken].data;
                        devices[devToken].connector.publish('v1/devices/me/telemetry',JSON.stringify(repeatdata,null,2));
                        devices[devToken].connector.publish('v1/devices/me/telemetry',json);
                    } else {
                        [chg,notchg] = getChangedAttributes(datatosend.values,devices[devToken].data.values);
                        if( chg.length != 0 ){
                          smalljson = JSON.stringify(datatosend.values,chg,2);
                          smalljson += '}';
                          smalljson = '{"ts":'+datatosend.ts+',  "values":'+smalljson;
                          devices[devToken].connector.publish('v1/devices/me/telemetry',smalljson);
                        }
                    }*/
                    this._devices[devToken].data = datatosend;
                } else {
                    let mqclient = mqtt.connect('mqtt://'+iotserver.host+':'+iotserver.port, {username: devToken});
                    let strClientId = 'mqclientid '+ mqclient.options.clientId;
                    this._devices[devToken] = { connector:mqclient, data:datatosend, sendalltime:datatosend.ts };
                    var loc_mqttclients = this._mqttclients;
                    var loc_devices = this._devices;
                    /*mqclient.on('connect', function () {
                      mqclient.publish('v1/devices/me/telemetry',json);
                      mqclient.on('connect',function(){});
                    });*/
                    mqclient.on('connect', function (topic, message) {
                      loc_mqttclients.count += 1;
                      console.log('thingsboard says connect, ' + strClientId, 'mqtt clients counts: ' + JSON.stringify(loc_mqttclients));
                      mqclient.publish('v1/devices/me/telemetry',json,function(err){
                        if(err) console.log("cann't publish on thingsboard, err:" + err );
                        mqclient.removeAllListeners('connect');
                        mqclient.on('connect',()=>{console.log('thingsboard says connect, '+strClientId);});
                        });
                      });
                    mqclient.on('message', function (topic, message) {
                      console.log('Response from thingsboard server: '+ message.toString());
                      });
                    mqclient.on('error', function (error) {
                      console.log(strClientId + ', Could not connect to thingsboard server with error: '+error);
                      console.log('Flush MQTT channel to thingsboard server');
                      loc_mqttclients.ended += 1;
                      mqclient.end();
                      delete loc_devices[devToken];
                      });
                    /*mqclient.on('reconnect', function () {
                      console.log('thingsboard says reconnect, we say good bye, mqclientid '+ mqclient.options.clientId);
                      mqclient.end();
                      delete devices[devToken];
                      });*/
                    /*mqclient.on('end', function () {//'end' is about client.end()!
                      console.log('thingsboard says end, mqclientid '+ mqclient.options.clientId);
                      mqclient.end();
                      delete devices[devToken];
                      });*/
                    mqclient.on('offline', function () {
                      console.log('thingsboard says offline, '+ strClientId);
                      //mqclient.end();
                      //delete devices[devToken];
                      });
                    mqclient.on('disconnect', function (p) {
                      console.log(strClientId + ', thingsboard says disconnect '+p);
                      //mqclient.end();
                      //delete devices[devToken];
                      });
                    mqclient.on('close', function () {
                      console.log('thingsboard says close, '+ strClientId);
                      loc_mqttclients.ended += 1;
                      mqclient.end();
                      delete loc_devices[devToken];
                      });
                }
            } else if (iotserver.protocol == 'https') {
                let telereq = https.request(teleoptions, function(res) {
                    if (res.statusCode >= 300) {
                        console.log('TB tele err');
                        console.log('STATUS: ' + res.statusCode);
                        console.log('HEADERS: ' + JSON.stringify(res.headers));
                        res.setEncoding('utf8');
                        res.on('data', function(chunk) {
                            console.log('BODY: ' + chunk);
                        });
                    } else {
                        //console.log('OK');
                    };
                });
                telereq.on('error', function(e) {
                    console.log('Problem with telemetry request: ' + e.message);
                });
                telereq.end(json);
            } else if ( iotserver.protocol == 'http' ){
                let telereq = http.request(teleoptions, function(res) {
                    if (res.statusCode >= 300) {
                        console.log('TB tele err');
                        console.log('STATUS: ' + res.statusCode);
                        console.log('HEADERS: ' + JSON.stringify(res.headers));
                        res.setEncoding('utf8');
                        res.on('data', function(chunk) {
                            console.log('BODY: ' + chunk);
                        });
                    } else {
                        //console.log('OK');
                    };
                });
                telereq.on('error', function(e) {
                    console.log('Problem with telemetry request: ' + e.message);
                });
                telereq.end(json);
            };
            //attreq.write(valuesjson);
            //attreq.end(valuesjson);
            //telereq.write(json);
            console.log('  ' + iotserver.type + ' server at ' + iotserver.host + ":" + iotserver.port);
          } else if (iotserver.type == 'azure') {
            let AzureConnectionString = 'HostName='+iotserver.host+'.azure-devices.net;DeviceId='+devEui+';SharedAccessKey='+devEui+devEui;
            console.log('Sending to Azure ' +AzureConnectionString);
            let AzureMqtt = require('azure-iot-device-mqtt').Mqtt;
            let AzureDeviceClient = require('azure-iot-device').Client;
            let AzureMessage = require('azure-iot-device').Message;
            let AzureClient = AzureDeviceClient.fromConnectionString(AzureConnectionString, AzureMqtt);
            let message = new AzureMessage(json);
            AzureClient.sendEvent(message, function (err) {
                if (err) {
                  console.error('send error: ' + err.toString());
                } else {
                  //console.log('message sent');
                }
            });
            AzureClient.close(function (err) {
                if (err) {
                  console.error('close error: ' + err.toString());
                } else {
                  //console.log('mqtt to azure server closed');
                }
            });
          } else if (iotserver.type == 'greenpl'){
              console.log("  Sending to GreenPL (host:" + iotserver.host + ")");
              if ( this._GreenPL.hasOwnProperty('client') ){
                this._GreenPL.client.publish('/devices/' + devEui, valuesjson, {"qos": 1, "retain": false},
                    function (error, response) {
                        // print response to console
                        console.log(response);
                        // if function was returned error then we printing this error to console
                        if (error) { console.log(error); }
                    });
              } else {
                this._GreenPL.client = mqtt.connect('mqtt://' + iotserver.host,
                    {username:iotserver.token, password:'1'}
                    );
                    this._GreenPL.client.on('connect', function () {
                  console.log('GreenPL says connect');
                  GreenPL.client.publish('/devices/' + devEui, valuesjson, {"qos": 1, "retain": false},
                      function (error, response) {
                          // print response to console
                          console.log(response);
                          // if function was returned error then we printing this error to console
                          if (error) { console.log(error); }
                          });
                      });

                this._GreenPL.client.on('message', function (topic, message) {
                  console.log('Response from GreenPL server: '+ message.toString());
                  });
                this._GreenPL.client.on('error', function (error) {
                  console.log('Could not connect to GreenPL server with error: "'+error+'"');
                  console.log('Flush MQTT channel to GreenPL server');
                  this._GreenPL.client.end();
                  delete this._GreenPL['client'];
                });
                this._GreenPL.client.on('offline', function () {
                  console.log('GreenPL says offline');
                  });
                this._GreenPL.client.on('disconnect', function (p) {
                  console.log('GreenPL says disconnect '+p);
                  });
                this._GreenPL.client.on('close', function () {
                  console.log('GreenPL says close');
                  if ( this._GreenPL.hasOwnProperty('client') ){
                    this._GreenPL.client.end();
                    delete this._GreenPL['client'];
                    }
                  });
              }
          } else {
              console.log('! Unknown IoT server type ' + iotserver.type);
          }
        },this);//iotservers.forEach
    } // sendevent

    closeconnectors()
        {
        this._stream.end();
        Object.entries(this._devices).forEach(([k,v])=>{
            v.connector.end();
            });
        this._devices = {};
        }

    async saveToFile (data) 
        {
        if ( typeof this._stream === "undefined" ) return;
        var json = JSON.stringify(data) + '\n';
        this._stream.write(json, (err) => {
            if (err) return console.log(err);
            console.log('The file has been saved.');
            });
        }
        
    } // class Publisher

module.exports = Publisher;  

function getChangedAttributes(newdata,olddata){
  var changed = [];
  var notchanged = [];
  Object.entries(newdata).forEach(([k,v])=>{
    if( olddata.hasOwnProperty(k) ){
      if( v != olddata[k] ){
        changed.push(k);
      } else {
        notchanged.push(k);
      }
    } else { changed.push(k); }
  });
  return [changed,notchanged];
}

/*function getChangedAttributes(newdata,olddata,maxsilence){
  changed = [];
  notchanged = [];
  var oldvalues = olddata.values;
  Object.entries(newdata.values).forEach(([k,v])=>{
    if( olddata.hasOwnProperty(k) ){
      if( v != olddata[k] ){
        changed.push(k);
      } else {
        notchanged.push(k);
      }
    } else { changed.push(k); }
  });
  for( let i = 0 ; i < blacklist.length ; i++ ){
    if( newdata.ts - olddata.ts >= maxsilence  ){

    }
  }

  return [changed,notchanged];
}
/*
if( iotserver.protocol == 'mqtt' ) {
    if ( devices.hasOwnProperty(devToken) ){
        if( datatosend.ts - devices[devToken].sendalltime >= iotserver.maxSilenceTime ){
            let repeatdata = devices[devToken].
            devices[devToken].connector.publish('v1/devices/me/telemetry',JSON)
            devices[devToken].connector.publish('v1/devices/me/telemetry',json);
            devices[devToken].data = datatosend;
        }
        [chng,notchng] = getChangedAttributes(datatosend,devices[devToken].data,iotserver.maxSilenceTime);
        if( chng.length != 0 ){
          smalljson = JSON.stringify(datatosend.values,chng,2);
          smalljson += '}';
          smalljson = '{"ts":'+datatosend.ts+',  "values":'+smalljson;
          devices[devToken].connector.publish('v1/devices/me/telemetry',smalljson);
          for(let i = 0 ; i < chng.length ; i++ ){
              devices[devToken].data[chng[i]] = { ts: datatosend.ts, value: datatosend.values[chng[i]] };
          }
        }
        devices[devToken].lasttime = datatosend.ts;
    } else {

*/
