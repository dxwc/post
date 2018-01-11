let fs   = require('fs');
let exec = require('child_process').exec;

// pandoc (http://pandoc.org/) must be installed and accessible from terminal
// markdown files must have .md ending

// Do not include ending '/' in setting these two variable value:
let md_dir   = '../../markdown'; // directory that will contain markdown [must exist]
let real_html_dir = '../../public'; // directory that will contain generated html

let html_dir = '.public'; // fake temporary, to generate first and then replace


let html_files = [];

Promise.resolve()
.then(() =>
{
    console.log(`--Generating corresponding files to temporary dir ${html_dir}`);
    return md_to_html(md_dir);
})
.then(() =>
{
    console.log('--Generating and saving ' + md_dir + '/links.md');
    let to_write =
`---
title: All internal page links
date: ${new Date().toLocaleDateString()}
---


`
    let href_text = '';
    for(let i = 0; i < html_files.length; ++i)
    {
        if
        (
            html_files[i].length > 10 &&
            html_files[i].search('index.html') === html_files[i].length - 10
        )
            href_text = html_files[i].substr(0, html_files[i].length-10);
        else
            href_text = html_files[i];
        to_write +=
`+ [${href_text}](${ html_files[i]})
`
    }

    fs.writeFileSync(md_dir+'/links.md', to_write);

    return run_command(`mkdir -p ${html_dir}`)
    .then(() =>
    {
        return run_command
        (`pandoc ${md_dir+'/links.md'} -f markdown -t html5 -so ${html_dir+'/links.html'} --template=template.html`)
    });
})
.then(() =>
{
    console.log('--Replacing old folder with new');
    return run_command(`rm -rf ${real_html_dir}; mv ${html_dir} ${real_html_dir}`);
})
.then(() =>
{
    console.info('--All complete');
})
.catch((err) =>
{
    console.info('==> Completed with an error:\n', err);
});


// ------------------------------------------------------------------------------

function md_to_html(markdown_root_dir)
{
    let inside_dir = fs.readdirSync(markdown_root_dir, { encoding : 'utf8'});

    let promise_chain = Promise.resolve();

    for(let i = 0; i < inside_dir.length; ++i)
    {
        if(fs.statSync(markdown_root_dir + '/' + inside_dir[i]).isDirectory())
        {
            md_to_html(markdown_root_dir + '/' + inside_dir[i]);
        }
        else if(inside_dir[i].slice(-2) == 'md')
        {
            let md_path   = markdown_root_dir + '/' + inside_dir[i];
            let html_path = html_dir + md_path.substr(md_dir.length)
                html_path = html_path.substr(0, html_path.length-3) + '.html';

            let md_files = md_path.substr(md_dir.length);
            html_files.push
            (md_files.substr(0, md_files.length-3) + '.html');

            promise_chain =
            promise_chain.then(() =>
            {
                return run_command
                    (`mkdir -p ${html_dir+markdown_root_dir.substr(md_dir.length)}`);

            })
            .then(() =>
            {
                return run_command
                (
                    `pandoc ${md_path} -f markdown -t html5 -so ${html_path} --template=template.html`
                );
            });
        }
        else if(inside_dir[i][0] !== '.')
        {
            let md_path   = markdown_root_dir + '/' + inside_dir[i];
            let html_path = html_dir + md_path.substr(md_dir.length);

            promise_chain =
            promise_chain.then(() =>
            {
                return run_command
                    (`mkdir -p ${html_dir+markdown_root_dir.substr(md_dir.length)}`);

            })
            .then(() =>
            {
                return run_command
                (
                    `cp ${md_path} ${html_path}`
                );
            });
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
                if(stdout) console.info('Stdout:', stdout);
                if(stderr) console.error('Stderr', stderr);
                resolve([stdout, stderr]);
            }
        });
    });
}