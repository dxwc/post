**Status**: Functional for my use

------

# A static site generator
With few more controls over feed generation than usual

+ Input: markdown, yaml
+ HTML out: pandoc + html5 template
+ Feed out: atom

# Setup

1. Be on linux terminal: `cd`, `mkdir`, `mv`, `rm` etc. command must be available
2. Have `make` installed and accessible from terminal
3. Have [pandoc](https://pandoc.org/) installed and accessible from terminal
4. Have ES6 supporting [Node.js](https://nodejs.org/) and `npm` installed and
   accessible from terminal
5. Know basics of [pandoc markdown syntax](http://pandoc.org/MANUAL.html#pandocs-markdown) -- note the yaml syntax as well

-------------

1. `git clone https://github.com/dxwc/post.git`
2. `cd ./post/generator/feed`
4. `npm install`
3. `cd ../../post`
    + site information for feed is set in `./generator/feed/_feed.yaml`
    + the posts goes in `markdown` folder
        + markdown files must have `.md` file extension
        + yaml data must be `---` enclosed
            + See the example post to view some of possible data that can be
              set [TODO: list all]
        + `title` is the only required yaml data per post

------------

**Tested working versions**:

+ node : 8.9.4
+ npm: 5.6.0
+ make: 4.2.1
+ pandoc: 1.19.2.1

# Use

+ `cd post/generator`
+ `make`
    + Will generate site HTMLs and atom feed XML in `post/public/` directory
        + Relative directory structures will be the same as markdown file
        + Non `.md` files that don't begin with `.` will be copied into generated
          directory in corresponding locations
        + an additional `links.md` file will be generated in markdown (and `links.html`
          in `public` dir)

# Feature TODO:

+ Replace content in database with hash
+ Category pages and atom schema
    + Tag/category differentiation with schema
+ Feed per category
