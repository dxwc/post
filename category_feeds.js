const parseString = require('xml2js').parseString;
const fs          = require('fs');
const util        = require('util');
const builder     = new (require('xml2js')).Builder();
const URL         = require('url').URL;

module.exports = function()
{
    return new Promise((resolve, reject) =>
    {

        let str = fs.readFileSync('./public/feed.xml', { encoding : 'utf-8' });

        parseString(str, (err, result) =>
        {
            if(err) reject('==> ERROR:', err);
            else
            {
                // console.log(util.inspect(result, false, null));
                let obj = {}; // each attribute is entry name, value is array
                              // with entries

                for(let i = 0; i < result.feed.entry.length; ++i)
                {
                    if(result.feed.entry[i].category !== undefined)
                    {
                        for(let k = 0; k < result.feed.entry[i].category.length; ++k)
                        {
                            if
                            (
                                obj[result.feed.entry[i].category[k].$.term]
                                ===
                                undefined
                            )
                            {
                                obj[result.feed.entry[i].category[k].$.term] =
                                    [result.feed.entry[i]];
                            }
                            else
                            {
                                obj[result.feed.entry[i].category[k].$.term].push
                                (
                                    result.feed.entry[i]
                                );
                            }
                        }
                    }
                }

                for(term_entries in obj)
                {
                    result.feed.entry = obj[term_entries];
                    for(let i = 0; i < result.feed.link.length; ++i)
                    {
                        if(result.feed.link[i].$.rel === 'self')
                            result.feed.link[i].$.href = new URL
                            (
                                `/category-feeds/${term_entries}.xml`,
                                new URL(result.feed.link[i].$.href).origin
                            );
                        else if(result.feed.link[i].$.rel === 'alternate')
                        {
                            result.feed.link[i].$.href = new URL
                            (
                                `/category/${term_entries}.html`,
                                new URL(result.feed.link[i].$.href).origin
                            );
                        }
                    }

                    try{ fs.mkdirSync('./public/category-feeds/'); }
                    catch(e) { }

                    console.log
                    (`--Writing ./public/category-feeds/${term_entries}.xml`);

                    fs.writeFileSync
                    (
                        `./public/category-feeds/${term_entries}.xml`,
                        builder.buildObject(result),
                        { encoding : 'utf-8' }
                    );
                }

                resolve();
            }
        });
    });
}