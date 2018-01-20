const fs          = require('fs');
const path        = require('path');
const URL         = require('url').URL;
const sqlite3     = require('sqlite3');
const uuidv4      = require('uuid/v4');
const yaml_parser = require('js-yaml');
const md5         = require('nano-md5');
const validator   = require('validator');
const exec        = require('child_process').exec;

class feed_generator
{
    constructor(feed_yaml, markdown_dir)
    {
        this.feed_yaml_path = feed_yaml || path.join(__dirname, 'feed.yaml');
        this.markdown_dir = markdown_dir || path.join(__dirname, 'markdown');

        try
        {
            console.log(`--Checking if exists: ${this.feed_yaml_path}`);
            fs.statSync(this.feed_yaml_path);
        }
        catch(err)
        {
            if(err.code === 'ENOENT')
            {
                console.info(`==> ${this.feed_yaml_path} doesn't exist.\n--Exiting`);
                process.exit(1);
            }
            else throw err;
        }

        try
        {
            console.log(`--Creating directory [if not exists]: ${this.markdown_dir}`);
            try{ fs.mkdirSync(this.markdown_dir) } catch(err) { }
            console.info(`==> No markdown files in ${this.markdown_dir}\n--Exiting`);
        }
        catch(err)
        {
            if(err.code !== 'EEXIST') throw err;
        }

        try
        {
            console.log(`--Attempting to read and parse yaml data`);
            this.feed_yaml = yaml_parser.safeLoad(
                        fs.readFileSync(this.feed_yaml_path, { encoding: 'utf-8'}));
        }
        catch(err)
        {
            console.log(`==> Couldn't open or parse data ${this.feed_yaml_path}`);
            process.exit(1);
        }

        console.log('--Checking if minimum required data found in yaml');
        if
        (
            !(typeof this.feed_yaml === 'object' &&
            typeof this.feed_yaml.title === 'string' &&
            typeof this.feed_yaml.id === 'string' &&
            typeof this.feed_yaml.authors === 'object' &&
            typeof this.feed_yaml.authors[0] === 'object' &&
            typeof this.feed_yaml.authors[0].name === 'string' &&
            this.feed_yaml.authors[0].name.length !== 0 &&
            validator.escape(this.feed_yaml.authors[0].name)
                ===
            this.feed_yaml.authors[0].name)
        )
        {
            console.log(`==> Minimum and valid required data (title, id and authors) `+
                        `not found in\n\t${this.feed_yaml_path}\n--Exiting`);
            process.exit(1);
        }


    }

    open_db()
    {
        return new Promise((resolve, reject) =>
        {
            console.log('--Opening database');
            this.db = new sqlite3.Database('feed.database', (err) =>
            {
                if(err) reject(err);
                this.sql_promise
                (
                    `
                    CREATE TABLE IF NOT EXISTS entry
                    (
                        id        TEXT PRIMARY KEY, -- UUID v4
                        published INTEGER NOT NULL, -- set on first insertion
                        updated   INTEGER NOT NULL, -- update if content is different
                        file_loc  TEXT NOT NULL UNIQUE, -- location of md file (rel)
                        md_hash   TEXT -- html/text content
                    );
                    `
                )
                .then(() =>
                {
                    return this.sql_promise
                    (
                        `CREATE INDEX IF NOT EXISTS file_loc_i ON entry(file_loc);`
                    );
                })
                .then(() =>
                {
                    return this.sql_promise
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
                    resolve();
                })
                .catch((err) =>
                {
                    reject(err);
                });
            });
        });
    }

    sql_promise(command)
    {
        return new Promise((resolve, reject) =>
        {
            if(this.db === undefined) reject('sql_promise used before db opened');
            this.db.run
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

    sql_get_promise(command)
    {
        if(this.db === undefined) reject('sql_get_promise used before db opened');
        return new Promise((resolve, reject) =>
        {
            this.db.get(command, (err, row) =>
            {
                if(err) reject(err);
                else resolve(row);
            });
        });
    }

    generate_person_construct(persons, tag)
    {
        let all = '';
        if(typeof persons !== 'object') return '';
        for(let i = 0; i < persons.length; ++i)
        {
            if(
                persons[i].name &&
                typeof persons[i].name !== 'string' ||
                persons[i].name.length === 0 ||
                validator.escape(persons[i].name) !== persons[i].name
            )
            {
                console.log(`==> Skipping an invalid ${tag}:name : ${persons[i].name}`)
                continue;
            }

            all +=
`
    <${tag}>
      <name>${persons[i].name}</name>
      ${
          typeof persons[i].email === 'string' &&
          persons[i].email.length > 0 &&
          validator.isEmail(persons[i].email) ?
            `<email>${persons[i].email}</email>` : ''}
      ${
          typeof persons[i].url === 'string' &&
          persons[i].url.length > 0 &&
          validator.isURL(persons[i].url) ?
            `<uri>${persons[i].url}</uri>` : ''}
    </${tag}>`
        }

        return all;
    }

    md_files(func_per_file)
    {
        if(typeof func_per_file !== 'function') throw new Error('no func');
        let dirs = [this.markdown_dir];
        let a_dir;
        while(dirs.length)
        {
            a_dir = dirs.pop();
            fs.readdirSync(a_dir, { encoding : 'utf8'})
            .forEach((item) =>
            {
                item = path.join(a_dir, item);
                if(fs.statSync(item).isDirectory())
                {
                    dirs.push(item);
                }
                else if(item.length > 3 && path.extname(item) === '.md')
                {
                    func_per_file(item);
                }
            });
        }
    }

    copy_non_md_files()
    {
        let dirs = [this.markdown_dir];
        let a_dir;
        while(dirs.length)
        {
            a_dir = dirs.pop();
            fs.readdirSync(a_dir, { encoding : 'utf8'})
            .forEach((item) =>
            {
                item = path.join(a_dir, item);
                if(fs.statSync(item).isDirectory())
                {
                    dirs.push(item);
                }
                else if
                (
                    item.length > 3 &&
                    path.extname(item) !== '.md' &&
                    path.basename(item)[0] !== '.'
                )
                {
                    let destination = path.join(__dirname, 'public', path.relative(this.markdown_dir, item));
                    try { fs.mkdirSync(path.dirname(destination)) } catch (err) { }
                    fs.copyFileSync(item, destination);
                }
            });
        }
    }


    run_command(command)
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
                    if(stderr) console.error('Stderr', stderr);
                    resolve([stdout, stderr]);
                }
            });
        });
    }


    generate_html()
    {
        let execSync = require("child_process").execSync;

        console.log('--Deleting existing public dir if exists');

        try { execSync(`rm -rf ${path.join(__dirname, 'public')}`) }
        catch(err) { console.log(err) }

        let pandoc_commands = [];
        this.md_files((file) =>
        {
            let public_dir = path.join
                            (
                                __dirname,
                                'public',
                                path.dirname(path.relative(this.markdown_dir, file))
                            );

            try { fs.mkdirSync(public_dir); } catch(err) { }
            pandoc_commands.push
            (
                this.run_command
                (
`pandoc ${file} \
-f markdown \
-t html5 \
--template=${path.join(__dirname, 'template.html')} \
-so ${path.join(public_dir, path.basename(file, '.md') + '.html')}`
                )
            );
        });

        return Promise.all(pandoc_commands);
    }


    entry_generator(entry)
    {
        if
        (!
            (entry &&
            typeof entry.id === 'string' &&
            entry.id.length > 0 &&
            typeof entry.title === 'string' &&
            entry.title.length > 0 &&
            typeof entry.updated === 'string' &&
            entry.updated.length > 0
           )
        )
        {
            console.log(`==> Entry doesn't have required data.\nExiting`);
            process.exit(1);
        }

        return `
    <entry>
        <id>${entry.id}</id>
        <title${validator.escape(entry.title) !== entry.title ? ` type='html'` : ''}>\
${validator.escape(entry.title)}</title>
        <updated>${entry.updated}</updated>
        ${typeof entry.authors === 'object' ?
            this.generate_person_construct(entry.authors, 'author') : ''}
        ${typeof entry.contributors === 'object' ?
            this.generate_person_construct(entry.contributors, 'contributor') : ''}
        ${typeof entry.alternate === 'string' && entry.alternate.length ?
            `<link type='text/html' rel='alternate' href='${entry.alternate}' />` : ''}
        ${typeof entry.content === 'string' && entry.content.length ?
        `<content type='html'>
            ${entry.content}
        </content>` : ''}
    </entry>
`
    }

    generate(entries)
    {
        console.log('--Generating Atom feed XML');
        return `
<?xml version='1.0' encoding='utf-8'?>
<feed xmlns='http://www.w3.org/2005/Atom'>
    <id>${validator.escape(this.feed_yaml.id)}</id>
    <title\
${validator.escape(this.feed_yaml.title) !== this.feed_yaml.title ?
` type='html'` : `` }>${validator.escape(this.feed_yaml.title)}</title>
    <updated>${new Date().toISOString()}</updated>
    ${this.generate_person_construct(this.feed_yaml.authors, 'author')}
    ${this.generate_person_construct(this.feed_yaml.contributors, 'contributor')}

    ${
        typeof this.feed_yaml.self_link === 'string' &&
        validator.isURL(this.feed_yaml.self_link) ?
`
    <link type='application/atom+xml' rel='self' href='${this.feed_yaml.self_link}'/>`
    : ''
    }

    ${
        typeof this.feed_yaml.alternate_link === 'string' &&
        validator.isURL(this.feed_yaml.alternate_link) ?
`
    <link type='text/html' rel='alternate' href='${this.feed_yaml.alternate_link}' />`
    : ''
    }

    ${
        typeof this.feed_yaml.icon === 'string' &&
        validator.isURL(this.feed_yaml.icon) ?
`
    <icon>${this.feed_yaml.icon}</icon>` : ''
    }

    ${
        typeof this.feed_yaml.logo === 'string' &&
        validator.isURL(this.feed_yaml.logo) ?
`
    <logo>${this.feed_yaml.logo}</logo>` : ''
    }

    ${
        typeof this.feed_yaml.rights === 'string' &&
        this.feed_yaml.rights.length > 0 ?
`
    <rights type='html'>${validator.escape(this.feed_yaml.rights)}</rights>` : ''
    }

    ${entries ? entries : ''}

</feed>
`.replace(/^\s*[\r\n]/gm, ''); // https://stackoverflow.com/a/16369725
    }


    all()
    {
        if
        (!
            (
                typeof this.feed_yaml.alternate_link === 'string' &&
                this.feed_yaml.alternate_link.length > 0 &&
                validator.isURL(this.feed_yaml.alternate_link)
            )
        )
        {
            return Promise.reject(`Couldn't find alternate_link in feed.yaml`);
        }

        let site_link = this.feed_yaml.alternate_link;
        this.generate_html()
        .then(() =>
        {
            console.log('--Finished generating html files into public dir');
            return this.open_db();
        })
        .then(() =>
        {
            let md_to_db_promise = [];
            this.md_files((file) =>
            {
                let content = fs.readFileSync(file, { encoding : 'utf-8'});
                let m1 = content.search('---');
                let m2 = content.indexOf('---', m1+4);
                if(m1 === -1 || m2 === -1) return;
                // throw new Error('Expected yaml seperators not found in ' + file);

                let yaml = yaml_parser.safeLoad(content.substr(m1+4, m2-5-m1));
                let md = content.substr(m2+5);

                let a_promise =
                this.sql_get_promise
                (
                    `
                    SELECT
                        id,
                        md_hash,
                        updated,
                        published,
                        file_loc
                    FROM entry
                    WHERE file_loc='${path.relative(this.markdown_dir, file)}'
                    `
                )
                .then((row) =>
                {
                    if(row && row.md_hash && row.id)
                    {
                        return row;
                    }
                    else
                    {
                        let id = uuidv4();
                        let md_hash = md5(md);
                        let published = new Date().getTime();
                        let updated = new Date().getTime();
                        let file_loc = path.relative(this.markdown_dir, file);

                        return this.sql_promise
                        (
                            `
                            INSERT INTO entry
                            (
                                id,
                                published,
                                updated,
                                file_loc,
                                md_hash
                            )
                            VALUES
                            (
                                '${id}',
                                '${published}',
                                '${updated}',
                                '${file_loc}',
                                '${md_hash}'
                            )
                            `
                        )
                        .then(() =>
                        {
                            return {
                                id : id,
                                md_hash : md_hash,
                                published : published,
                                updated : updated,
                                file_loc : file_loc
                            };
                        });
                    }
                })
                .then((row) =>
                {
                    if(md5(md) !== row.md_hash)
                    {
                        row.md_hash = md5(md);
                        row.updated = new Date().getTime();
                        console.log
                        ('--Updating hash and update time as content changed');
                        return this.sql_promise
                        (
                            `
                            UPDATE entry
                            SET
                                updated='${row.updated}',
                                md_hash='${row.md_hash}'
                            WHERE
                                id='${row.id}'
                            `
                        )
                        .then(() =>
                        {
                            return row;
                        });
                    }
                    else
                    {
                        return row;
                    }
                })
                .then((row) =>
                {
                    yaml.id = row.id;
                    yaml.published = new Date(row.published).toISOString();
                    yaml.updated = new Date(row.updated).toISOString();
                    yaml.alternate =
                                    new URL(
                                        path.join(
                                            path.dirname(row.file_loc),
                                            path.basename(row.file_loc, '.md') + '.html'
                                        ),
                                        site_link
                                    ).href;
                    return;
                })
                .then(() =>
                {
                    return this.run_command(`pandoc ${file} -f markdown -t html5`)
                    .then((result) =>
                    {
                        if(result && typeof result[0] === 'string')
                            yaml.content = validator.escape(result[0]);
                        else
                            throw new Error('pandoc error on entry', file);

                        return;
                    });
                })
                .then(() =>
                {
                    return this.entry_generator(yaml);
                })

                md_to_db_promise.push(a_promise);
            });

            return Promise.all(md_to_db_promise);
        })
        .then((result) =>
        {
            if(result === undefined) console.log('No entry?');

            let all_entries = '';
            for(let i = 0; i < result.length; ++i)
            {
                all_entries += result[i];
            }

            fs.writeFileSync
            (
                path.join(__dirname, 'public', 'feed.xml'),
                this.generate(all_entries),
                { encoding : 'utf-8' }
            );

            console.log('--Written feed.xml in public dir');
            console.log('--Copying other files from markdown dir to public');
            this.copy_non_md_files();
            console.log('--All complete');
        })
        .catch((err) =>
        {
            console.log('err', err);
        });
    }
}

let fg = new feed_generator();
fg.all();