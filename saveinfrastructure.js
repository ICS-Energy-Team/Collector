// @ts-check
'use sctrict';
const { readFile, opendir, writeFile } = require('fs/promises');

async function get_configs(dir){
    let jsons = [];
    try {
        const d = await opendir(dir);
        for await (const dirent of d) {
            if( dirent.isFile() && dirent.name.endsWith('.json') ) { jsons.push(dirent.name); };
            }
    } catch (err) {
        console.error(err);
    }
    return jsons.map( name => readFile(name,'utf8') );
}

function* search_in_array(array,depth){
    
    }
function* search_in_object(obj,depth){
    if( depth === undefined ){
        depth = 1;
        }
    let { host, tbtoken } = obj;
    if( host && tbtoken )
        yield { host, tbtoken };
    if( depth < 1 ) return;

    for(const [key, value] of Object.entries(obj)) {
        if(Array.isArray(value) && depth > 0) {
            yield* search_in_array(value, depth - 1);
            }
        else if (typeof value === 'object' ) {
            yield* search_in_object(value, depth - 1) ;
            }
        }
    }

get_configs('.')
.then( arr => Promise.all(arr) )
.then( arr => {
    let devices = [];
    for( let f of arr ){
        let c = JSON.parse(f);
        if( c.moxa && c.moxa.host && c.moxa.tbtoken ) {
            devices.push({ip:c.moxa.host, tbtoken: c.moxa.tbtoken});
            }
        }
    return devices;
    } )
.then( devices =>
    writeFile('infrastructure.info',JSON.stringify(devices),'utf8')
    )
