# TODO

- replace deleting public dir with temporary dir and mv to replace dir once complete
- replace exec with execSync where possible
- reduce multiple loops of file traversal to one/two
- generate site map with link

# Changes

- Requiring top level author to exists even though atom does not necessarily require
  top level author if all entries have authors
    - Since entries data will be hand generated, it is safer to have top level
      author
- Making URI requirement of atom as URL
- Allow only one self link and one alternate link on top level