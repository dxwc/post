const fs       = require('fs');
const yaml     = require('js-yaml');
const sqlite3  = require('sqlite3');
const readline = require('readline');
const uuidv4   = require('uuid/v4');
const exec     = require('child_process').exec;

// >------------- Sqlite3 callbacks promisify ------------->

function sql_promise(command)
{
    return new Promise((resolve, reject) =>
    {
        db.run
        (
            command, (result, err) =>
            {
                if(result && result.errno) reject(result);
                else if(err) reject(err);
                else resolve();
            }
        );
    });
}

function open_db_global()
{
    return new Promise((resolve, reject) =>
    {
        global.db = new sqlite3.Database('entries.data', (err) =>
        {
            if(err) reject(err);
            sql_promise
            (
                `
                CREATE TABLE IF NOT EXISTS entry
                (
                    id       TEXT PRIMARY KEY, -- UUID v4
                    updated  TEXT NOT NULL, -- update if content is different
                    file_loc TEXT NOT NULL, -- location of md file
                    content  TEXT -- html/text content
                );
                `
            )
            .then(() =>
            {
                return sql_promise
                (
                    `
                    CREATE TABLE IF NOT EXISTS just_id
                    (
                        id TEXT PRIMARY KEY -- UUID v4
                    );
                    `
                );
            })
            .then(() =>
            {
                resolve(global.db);
            })
            .catch((err) =>
            {
                reject(err);
            });
        });
    });
}

function db_get_promise(command)
{
    return new Promise((resolve, reject) =>
    {
        db.get(command, (err, row) =>
        {
            if(err) reject(err);
            else resolve(row);
        });
    });
}

function db_run_promise(command)
{
    return new Promise((resolve, reject) =>
    {
        db.run(command, [], (err) =>
        {
            if(err) reject(err);
            else resolve();
        });
    });
}

// <------------- Sqlite3 callbacks promisify -------------<

/* Output a question, get a stdin line */
function read_line_promise(question)
{
    return new Promise((resolve, reject) =>
    {
        let rl = readline.createInterface
        ({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(question, (answer) =>
        {
            resolve(answer);
            rl.close();
        });
    });
}

// >------------- Generator and helpers ------------->

function category_generator(categories)
{
    let all = '';
    if(categories === undefined) return all;
    for(let i = 0; i < categories.length; ++i)
    {
        all +=
`
  <category
    term='${categories[i].term}'
    ${categories[i].label ? `label='${categories[i].label}'` : ''}
    ${categories[i].schema ? `schema='${categories[i].schema}'` : ''}
    />`
    }
    return all;
}

function person_construct_generator(person, tagname)
{
    let all = '';
    if(person === undefined) return all;
    for(let i = 0; i < person.length; ++i)
    {
        all +=
`
  <${tagname}>
    ${person[i].name ? `<name>${person[i].name}</name>` : ''}
    ${person[i].email ? `<email>${person[i].email}</email>` : ''}
    ${person[i].uri ? `<uri>${person[i].uri}</uri>` : ''}
  </${tagname}>
`
    }

    return all;
}

function generate_feed(feed, entries)
{

let xml = `<?xml version='1.0' encoding='utf-8'?>
<feed xmlns='http://www.w3.org/2005/Atom'>

  <id>${feed.id}</id>
  <title>${feed.title}</title>
  <updated>${new Date().toISOString()}</updated>
  ${feed.subtitle ? feed.subtitle : ''}
  ${person_construct_generator(feed.authors, 'author')}
  ${feed.link.self ? `<link rel='self' href='${feed.link.self}' />` : ''}
  ${feed.icon ? `<icon>${feed.icon}</icon>` : ''}
  ${feed.logo ? `<logo>${feed.logo}</logo>` : ''}
  ${feed.rights ? `<rights>${feed.logo}</rights>` : ''}
  ${feed.generator.name ?
    `<generator
        ${feed.generator.uri ? `uri='${feed.generator.uri}'` : ''}
        ${feed.generator.version ? `version='${feed.generator.version}'` : ''}>
        ${feed.generator.name}
    </generator>` : ''}
    ${category_generator(feed.categories)}
    ${person_construct_generator(feed.contributors, 'contributor')}

</feed>`;

    xml = xml.replace(/^\s*[\r\n]/gm, ''); // https://stackoverflow.com/a/16369725
    return xml;
}

// <------------- Generator and helpers <-------------


/* Extracts yaml within '---\n' and '\n---'. Rest are assumed to be markdown */
function extract_from_md(file)
{
    let obj = { yaml : '', md : '' }
    let all = fs.readFileSync(file, { encoding: 'utf-8'});
    let m1 = all.indexOf('---');
    let m2 = all.indexOf('---', m1+4)

    if(m1 === -1 || m2 === -1) throw new Error('Expected yaml seperators not found');

    obj.yaml = all.substr(m1+4, m2-5-m1);
    obj.md = all.substr(m2+5);

    return obj;
}


// -----------------------------------------------------------------------------------

// Feed init generation example:

let feed_id;
let feed;

open_db_global()
.then(() =>
{
    return db_get_promise('SELECT id FROM just_id');
})
.then((data) =>
{
    if(data && data.id) feed_id = data.id;
    return db_get_promise('SELECT count(*) as `count` FROM entry');
})
.then((data) =>
{
    feed = yaml.safeLoad(fs.readFileSync('./_feed.yaml', { encoding : 'utf-8'}));
    if(feed.id === undefined || feed.title === undefined)
        throw new Error('feed id or title not found in ./__feed.yaml file');

    if(data.count === 0 && feed_id === undefined)
    {
        feed_id = undefined; // won't be needing any longer
        return db_get_promise(`INSERT INTO just_id(id) VALUES('${feed.id}')`);
    }
    else if(feed_id !== feed.id && data.count > 0)
    {
        console.log('PERMANENT FEED ID CHANGED AND THERE ARE EXISTING ENTRRIES!');
        console.log('THIS SHOULDN\'T HAPPEN!');
        console.log('THE CORRECT ID IS (set it in _feed.yaml if changed accidently):');
        console.log(feed_id);
        throw new Error();
    }
    else if(feed_id !== feed.id && data.count === 0)
    {
        return read_line_promise('Do you want to change feed ID? [y/n]')
        .then((answer) =>
        {
            if(answer === 'y' || answer === 'Y')
            {
                console.log('--Updating');
                return db_run_promise(`UPDATE just_id set id = '${feed.id}'`);
            }
            else
            {
                console.log('--Keeping existing ID in database');
                console.log('--You must update the ./_feed.yml id field to:');
                console.log(feed_id);
                feed.id = feed_id;
            }
        });
    }
    else
    {
        return; // all good
    }
})
.then(() =>
{
    console.log(generate_feed(feed));
    db.close();
})
.catch((err) =>
{
    console.log('Error in chain:\n', err);
    db.close();
});