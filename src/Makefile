.PHONY: help Makefile clean view

first_target: help

help:
	@echo "Please use \`make <target>' where <target> is one of"
	@echo "  clean            to clean HTML files"
	@echo "  view             to view the built HTML"

clean:
	rm -rf public resources

view:
	@python -c "import webbrowser; webbrowser.open_new_tab('file://$(PWD)/public/index.html')"
