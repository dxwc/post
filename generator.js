const fs          = require('fs');
const path        = require('path');
const yaml_parser = require('js-yaml');
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
            fs.mkdirSync(this.markdown_dir);
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
                    if(stdout) console.info('Stdout:', stdout);
                    if(stderr) console.error('Stderr', stderr);
                    resolve([stdout, stderr]);
                }
            });
        });
    }

    generate_html()
    {
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
            console.log(`==> Entry doesn't have valid data.\nExiting`);
            process.exit(1);
        }

        return `
    <entry>
        <id>${entry.id}</id>
        <title${validator.escape(entry.title) !== entry.title ? ` type='html'` : ''}>
            ${validator.escape(entry.title)}
        </title>
        <updated>${entry.updated}</updated>
        ${typeof entry.authors === 'object' ?
            this.generate_person_construct(entry.authors, 'author') : ''}
        ${typeof entry.contributors === 'object' ?
            this.generate_person_construct(entry.contributors, 'contributor') : ''}
    </entry>
`
    }

    generate()
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
    <link type='alternate' rel='alternate' href='${this.feed_yaml.alternate_link}' />`
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

</feed>
`.replace(/^\s*[\r\n]/gm, ''); // https://stackoverflow.com/a/16369725
    }
}

let fg = new feed_generator();
let atom = fg.generate();
console.log(atom);
console.log(fg.entry_generator(
{
    id: 'asdasd',
    title: '<b>Coool</b>',
    updated: new Date().toISOString(),
    authors:
    [
        { name: 'Bob', email : 'bob@example.com' }
    ]
}));




fg.generate_html()
.then(() =>
{
    console.log('all converted');
})
.catch((err) =>
{
    console.log('err', err);
})