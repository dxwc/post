# TODO

- make command line calls portable ( see [shelljs](https://www.npmjs.com/package/shelljs))
- generate category pages
- replace exec with execSync where possible
- reduce multiple loops of file traversal to one/two

# Changes

- make top level self link and alternate link required
- Requiring top level author to exists even though atom does not necessarily require
  top level author if all entries have authors
    - Since entries data will be hand generated, it is safer to have top level
      author
- Making URI requirement of atom as URL
- Allow only one self link and one alternate link on top level
