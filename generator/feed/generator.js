const fs        = require('fs');
const yaml      = require('js-yaml');
const sqlite3   = require('sqlite3');
const readline  = require('readline');
const uuidv4    = require('uuid/v4');
const exec      = require('child_process').exec;
const validator = require('validator');

let feed;
let feed_id;
let md_dir = '../../markdown';
let all_entries = '';

// TODO:
// + add matching alternate links to entries for generated pages
// + see if tags can be added easily or should be omitted

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
})
.then(() =>
{
    return traverse_md_files(md_dir);
})
.then(() =>
{
    return db_get_promise
    (
        `SELECT updated FROM entry ORDER BY updated DESC LIMIT 1`
    );
})
.then((result) =>
{
    fs.writeFileSync
    (
        './atom.xml',
        generate_feed(feed, all_entries, result.updated),
        { encoding : 'utf-8'}
    );
    console.log('--Generated ./atom.xml file');
    db.close();
})
.catch((err) =>
{
    console.log('Error in chain:\n', err);
    db.close();
});




// ---------------------------------------------------------
// ---------------------------------------------------------


// for normal usages should be good enough
function md_path_to_category(md_path)
{
    let category_arr = md_path.split('/');
    category_arr = category_arr.filter((value) =>
    {
        return value.length > 1 && value[0] !== '.';
    });
    category_arr = category_arr.slice(0, category_arr.length-1);

    let all = '';
    for(let i = 0; i < category_arr.length; ++i)
    {
        all += `<category term='${category_arr[i]}' label='${category_arr[i]}' />
    `
    }
    return all;
}


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
                    id        TEXT PRIMARY KEY, -- UUID v4
                    published INTEGER NOT NULL, -- set on first insertion
                    updated   INTEGER NOT NULL, -- update if content is different
                    file_loc  TEXT NOT NULL UNIQUE, -- location of md file
                    content   TEXT -- html/text content
                );
                `
            )
            .then(() =>
            {
                return sql_promise
                (
                    `CREATE INDEX IF NOT EXISTS file_loc_i ON entry(file_loc);`
                );
            })
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
    ${categories[i].label ?
        `label='${categories[i].label}'` :
        `label='${categories[i].term}'`}
    ${categories[i].schema ? `schema='${categories[i].schema}'` : ''}
    />
`;
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

function link_generator(links)
{
    let all = '';
    if(links === undefined) return all;
    for(let i = 0; i < links.length; ++i)
    {
        if(!links[i].href || links[i].href.length === 0) continue;
        all +=
`<link
      ${links[i].rel ? `rel='${links[i].rel}'` : ''}
      ${links[i].type ? `type='${links[i].type}'` : ''}
      href='${links[i].href}'
    />`;
    }

    return all;

}

function generate_feed(feed, entries, updated)
{

let xml = `<?xml version='1.0' encoding='utf-8'?>
<feed xmlns='http://www.w3.org/2005/Atom'>

  <id>${feed.id}</id>
  <title type='html'>${validator.escape(feed.title)}</title>
  <updated>${new Date(updated).toISOString()}</updated>
  ${feed.subtitle ? feed.subtitle : ''}
  ${person_construct_generator(feed.authors, 'author')}
  ${link_generator(feed.links)}
  ${feed.icon ? `<icon>${feed.icon}</icon>` : ''}
  ${feed.logo ? `<logo>${feed.logo}</logo>` : ''}
  ${feed.rights ? `<rights type='html'>${validator.escape(feed.rights)}</rights>` : ''}
  ${feed.generator.name ?
    `<generator
        ${feed.generator.uri ? `uri='${feed.generator.uri}'` : ''}
        ${feed.generator.version ? `version='${feed.generator.version}'` : ''}>
        ${feed.generator.name}
    </generator>` : ''}
    ${category_generator(feed.categories)}
    ${person_construct_generator(feed.contributors, 'contributor')}

    ${entries}

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

    obj.yaml = yaml.safeLoad(all.substr(m1+4, m2-5-m1));
    obj.md = all.substr(m2+5);

    return obj;
}

function traverse_md_files(markdown_root_dir)
{
    let inside_dir = fs.readdirSync(markdown_root_dir, { encoding : 'utf8'});

    let promise_chain = Promise.resolve();
    let obj;

    for(let i = 0; i < inside_dir.length; ++i)
    {
        if(fs.statSync(markdown_root_dir + '/' + inside_dir[i]).isDirectory())
        {
            traverse_md_files(markdown_root_dir + '/' + inside_dir[i]);
        }
        else if(inside_dir[i].slice(-2) == 'md')
        {
            // TODO: see if it is a good idea to make it async instead of chain
            let loc = markdown_root_dir + '/' + inside_dir[i];
            promise_chain = promise_chain.then(() =>
            {
                return check_entry(loc, extract_from_md(loc));
            });
        }
        else if(inside_dir[i][0] !== '.')
        {
            // non .md or temporary/hidden file, action: copy
        }
    }

    return promise_chain;
}

function run_command(command)
{
    return new Promise((resolve, reject) =>
    {
        console.log('Executing:', command);
        exec(command, (err, stdout, stderr) =>
        {
            if(err)
            {
                reject(err);
            }
            else
            {
                // if(stdout) console.info('Stdout:', stdout);
                if(stderr) console.error('Stderr', stderr);
                resolve([stdout, stderr]);
            }
        });
    });
}

/* md_file === full [relative to root md_dir] file location of a md file */
function check_entry(md_file_loc, data)
{
    let extracted_md = data.md;
    if(md_file_loc === undefined || extracted_md === undefined)
        throw new Error('md_file or extracted_md was undefined');

    md_file_loc = validator.escape(md_file_loc);
    extracted_md = validator.escape(extracted_md);

    let content_diff = false; // indicate need to generate
    let entry_id = uuidv4();
    let updated = new Date().getTime();
    let published = new Date().toISOString();
    let loc;

    // TODO, date update/insert -- check yaml/file-change for info, else current
    // TODO, replace content with hash to save space

    return db_get_promise(`SELECT * FROM entry where file_loc='${md_file_loc}'`)
    .then((result) =>
    {
        let category = category_generator(data.yaml.categories);
        category += md_path_to_category(validator.unescape(md_file_loc));
        // console.log(category);
        // TODO: add category label schema url from _feed.yaml

        if(result === undefined)
        {
            content_diff = true;
            return db_run_promise
            (
                `
                INSERT INTO entry
                (
                    id,
                    published,
                    updated,
                    file_loc,
                    content
                )
                VALUES
                (
                    '${entry_id}',
                    '${updated}',
                    '${updated}',
                    '${md_file_loc}',
                    '${extracted_md}'
                )
                `
            );
        }
        else
        {
            entry_id = result.id;
            content_diff = (result.content !== extracted_md);
            published = result.published;
            loc = validator.unescape(result.file_loc);

            if(content_diff)
            {
                return db_run_promise
                (
                    `
                    UPDATE entry
                    SET
                        content = '${extracted_md}',
                        updated = '${updated}'
                    WHERE
                        id = '${entry_id}'
                    `
                );
            }
            else
            {
                updated = result.updated;
                return;
            }
        }
    })
    .then(() =>
    {
        return run_command
        (
            `pandoc -f markdown -t html5 ${validator.unescape(md_file_loc)}`
        );
    })
    .then((result) =>
    {
        all_entries +=
`
  <entry>
    <id>${entry_id}</id>
    <title>${data.yaml.title}</title>
    <updated>${new Date(updated).toISOString()}</updated>
    <published>${new Date(published).toISOString()}</published>
    <content type='html'>
    ${validator.escape(result[0])}
    </content>
    ${person_construct_generator(data.yaml.authors, 'author')}
    ${link_generator(data.yaml.links)}
    ${category_generator(data.yaml.categories)}
    ${md_path_to_category(loc)}
    ${person_construct_generator(data.yaml.contributors, 'contributor')}
    ${data.yaml.summary ?
`<summary type='html'>
      ${validator.escape(data.yaml.summary)}
    </summary>` : ''}
    ${data.yaml.rights ?
`<rights type='html'>${validator.escape(data.yaml.rights)}</rights>` : ''}
  </entry>
`;
    })
    .then(() =>
    {
        return { content_diff : content_diff, entry_id : entry_id };
    });
}
